import { useId } from "react";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import { cn } from "../../../shared/ui/cn";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useHomeWorkspaces } from "../../home/api/useHomeWorkspaces";
import { argumentPicker, argumentPickerKind } from "../runtime/argumentPickers";
import {
  hasChoices,
  humanizeValue,
  type FieldValue,
  type FieldValues,
} from "../runtime/argumentValues";
import type { CommandArgumentInfo } from "../types";
import {
  CONTROL_CLASS,
  emptyPresetLabel,
  selectEmptyLabel,
  selectPropsOf,
  type ArgumentFormMode,
  type ControlProps,
} from "./argumentControlParts";
import { PickerControl } from "./ArgumentPickerFields";
import { ChoiceSelect } from "./ChoiceSelect";
import { ConversationSelect } from "./ConversationArgumentFields";
import { MemberField } from "./MemberArgumentFields";

export type { ArgumentFormMode } from "./argumentControlParts";

/** This account's workspaces, as a select. */
function WorkspaceSelect(props: ControlProps) {
  const { workspaces, isPending } = useHomeWorkspaces();
  const options = workspaces.map((workspace) => ({
    value: workspace.id,
    label: showInvisibleCharacters(workspace.label),
  }));
  return (
    <ChoiceSelect
      {...selectPropsOf(props)}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={props.onChange}
      options={options}
      emptyLabel={selectEmptyLabel(
        props.argument,
        props.mode,
        isPending ? "Loading workspaces…" : "Choose a workspace",
      )}
    />
  );
}

/**
 * The control of one argument: the field the argument picker map names for it, else the one its
 * type gives.
 */
function ArgumentControl(props: ControlProps) {
  const { argument, value, onChange, mode, controlId, describedBy, invalid, autoFocus } = props;
  const describe = { "aria-describedby": describedBy, "aria-invalid": invalid || undefined };
  const picker = argumentPicker(props.commandId, argument.name);
  if (picker?.kind && picker.kind !== "targetWorkspace") {
    return <PickerControl {...props} picker={picker} />;
  }
  if (hasChoices(argument)) {
    return (
      <ChoiceSelect
        {...selectPropsOf(props)}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        options={(argument.allowedValues ?? []).map((allowed) => ({
          value: allowed,
          label: picker?.valueLabels?.[allowed] ?? humanizeValue(allowed),
        }))}
        emptyLabel={
          mode === "preset" || !argument.required || value === ""
            ? selectEmptyLabel(argument, mode, "Choose…")
            : null
        }
      />
    );
  }
  switch (argument.argumentType) {
    case CommandArgumentType.BOOLEAN:
      if (mode === "preset") {
        return (
          <ChoiceSelect
            {...selectPropsOf(props)}
            value={typeof value === "boolean" ? String(value) : ""}
            onChange={(next) => onChange(next === "" ? "" : next === "true")}
            options={[
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]}
            emptyLabel={emptyPresetLabel(argument)}
          />
        );
      }
      return (
        <input
          id={controlId}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          autoFocus={autoFocus}
          className="h-4 w-4 accent-rim-accent"
          {...describe}
        />
      );
    case CommandArgumentType.INTEGER:
    case CommandArgumentType.FLOAT:
      return (
        <input
          id={controlId}
          type="text"
          inputMode={argument.argumentType === CommandArgumentType.INTEGER ? "numeric" : "decimal"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={mode === "preset" ? emptyPresetLabel(argument) : undefined}
          autoFocus={autoFocus}
          className={CONTROL_CLASS}
          {...describe}
        />
      );
    case CommandArgumentType.USER_ID:
      return <MemberField {...props} />;
    case CommandArgumentType.CONVERSATION_ID:
      return <ConversationSelect {...props} />;
    case CommandArgumentType.WORKSPACE_ID:
      return <WorkspaceSelect {...props} />;
    default:
      if (argument.argumentType === CommandArgumentType.STRING && argument.name === "text") {
        return (
          <textarea
            id={controlId}
            rows={4}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && props.onSubmit) {
                e.preventDefault();
                props.onSubmit();
              }
            }}
            placeholder={mode === "preset" ? emptyPresetLabel(argument) : undefined}
            autoFocus={autoFocus}
            className={CONTROL_CLASS}
            {...describe}
          />
        );
      }
      return (
        <input
          id={controlId}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={mode === "preset" ? emptyPresetLabel(argument) : undefined}
          autoFocus={autoFocus}
          className={CONTROL_CLASS}
          {...describe}
        />
      );
  }
}

export interface ArgumentFieldProps {
  argument: CommandArgumentInfo;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  mode: ArgumentFormMode;
  /** Why the value cannot be used, shown under the field. */
  problem?: string | null;
  /** The workspace whose members and conversations the field offers; the open one when left out. */
  workspaceId?: string;
  /** The command the argument is of, which picks the field for some arguments. */
  commandId?: string;
  /** What the form's fields hold now, for a field that follows another, such as a scope. */
  formValues?: Readonly<FieldValues>;
  autoFocus?: boolean;
  /** Runs the form, for a field that takes Enter for itself, such as the member search. */
  onSubmit?: () => void;
}

const NO_VALUES: Readonly<FieldValues> = {};

/**
 * One argument of a command as a form field: its title as the label, its description as the
 * hint, and the control its type asks for. A checkbox has its label beside it.
 */
export function ArgumentField({
  argument,
  value,
  onChange,
  mode,
  problem = null,
  workspaceId,
  commandId,
  formValues = NO_VALUES,
  autoFocus = false,
  onSubmit,
}: ArgumentFieldProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const hintId = `${baseId}-hint`;
  const problemId = `${baseId}-problem`;
  const describedBy =
    [argument.description ? hintId : null, problem ? problemId : null].filter(Boolean).join(" ") ||
    undefined;
  const label = argument.title || humanizeValue(argument.name);
  const checkbox = argument.argumentType === CommandArgumentType.BOOLEAN && mode === "ask";
  const control = (
    <ArgumentControl
      argument={argument}
      value={value}
      onChange={onChange}
      mode={mode}
      controlId={controlId}
      describedBy={describedBy}
      invalid={problem !== null}
      autoFocus={autoFocus}
      workspaceId={workspaceId}
      commandId={commandId}
      formValues={formValues}
      onSubmit={onSubmit}
    />
  );
  return (
    <div className="space-y-1" data-argument={argument.name}>
      {checkbox ? (
        <div className="flex items-center gap-2">
          {control}
          <label htmlFor={controlId} className="text-sm text-rim-text">
            {label}
          </label>
        </div>
      ) : (
        <>
          <label htmlFor={controlId} className="block text-xs text-rim-text-muted">
            {label}
            {!argument.required && <span className="text-rim-text-faint"> (optional)</span>}
          </label>
          {control}
        </>
      )}
      {argument.description && (
        <p id={hintId} className={cn("text-xs text-rim-text-faint", checkbox && "pl-6")}>
          {argument.description}
        </p>
      )}
      {problem && (
        <p id={problemId} className="text-xs text-rim-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

export interface ArgumentFieldListProps {
  fields: readonly CommandArgumentInfo[];
  values: FieldValues;
  onChange: (name: string, value: FieldValue) => void;
  mode: ArgumentFormMode;
  problems?: Readonly<Record<string, string>>;
  /** The workspace whose members and conversations the fields offer, unless a field picks one. */
  workspaceId?: string;
  /** The command the fields are of, which picks the field for some arguments. */
  commandId?: string;
  /**
   * Values the command already has that the form does not show, such as the conversation it
   * runs in, for fields that follow them.
   */
  givenValues?: Readonly<FieldValues>;
  /** Whether the first field takes focus when the list appears. */
  autoFocusFirst?: boolean;
  onSubmit?: () => void;
}

/**
 * A field for each of `fields`. A member or conversation field offers those of the workspace a
 * workspace field among them picks, else of `workspaceId`; a workspace to go to picks none.
 */
export function ArgumentFieldList({
  fields,
  values,
  onChange,
  mode,
  problems = {},
  workspaceId,
  commandId,
  givenValues,
  autoFocusFirst = false,
  onSubmit,
}: ArgumentFieldListProps) {
  const formValues = givenValues ? { ...givenValues, ...values } : values;
  const pickedWorkspace = fields
    .filter(
      (field) =>
        field.argumentType === CommandArgumentType.WORKSPACE_ID &&
        argumentPickerKind(commandId, field.name) !== "targetWorkspace",
    )
    .map((field) => values[field.name])
    .find((value): value is string => typeof value === "string" && value !== "");
  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <ArgumentField
          key={field.name}
          argument={field}
          value={values[field.name] ?? ""}
          onChange={(value) => onChange(field.name, value)}
          mode={mode}
          problem={problems[field.name] ?? null}
          workspaceId={pickedWorkspace ?? workspaceId}
          commandId={commandId}
          formValues={formValues}
          autoFocus={autoFocusFirst && index === 0}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

export interface PresetArgumentsSectionProps {
  fields: readonly CommandArgumentInfo[];
  /** The fields' values, or `null` when the saved arguments do not fit the fields. */
  values: FieldValues | null;
  onChange: (name: string, value: FieldValue) => void;
  /** The saved arguments, shown as they are when they do not fit the fields. */
  saved?: unknown;
  problems?: Readonly<Record<string, string>>;
  /** The workspace whose members and conversations the fields offer. */
  workspaceId?: string;
  /** The command the arguments are saved for, which picks the field for some of them. */
  commandId?: string;
  /** What happens to an empty required field, such as "asked for when the key is pressed". */
  emptyNote: string;
  /** Replaces the sentence about empty fields, for a form whose fields are never asked. */
  intro?: string;
  /** The text size of the section: `xs` in the compact keybind list, `sm` in a dialog. */
  size?: "xs" | "sm";
}

/**
 * The arguments a keybind or quick action saves, as fields: an empty one is asked for when the
 * command runs, or left to its default. Saved arguments the fields cannot show are listed as
 * JSON and kept unchanged.
 */
export function PresetArgumentsSection({
  fields,
  values,
  onChange,
  saved,
  problems,
  workspaceId,
  commandId,
  emptyNote,
  intro,
  size = "sm",
}: PresetArgumentsSectionProps) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-rim-line p-2.5">
      <legend className={cn("px-1 text-rim-text-muted", size === "xs" ? "text-[11px]" : "text-xs")}>
        Arguments
      </legend>
      {values === null ? (
        <p className="text-xs text-rim-text-muted">
          Saved as{" "}
          <code className="break-all font-mono text-rim-text">{JSON.stringify(saved)}</code>, kept
          as they are.
        </p>
      ) : (
        <>
          <p className="text-xs text-rim-text-faint">
            {intro ?? `Optional. A required field left empty is ${emptyNote}.`}
          </p>
          <ArgumentFieldList
            fields={fields}
            values={values}
            onChange={onChange}
            mode="preset"
            problems={problems}
            workspaceId={workspaceId}
            commandId={commandId}
          />
        </>
      )}
    </fieldset>
  );
}
