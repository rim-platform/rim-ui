import { useDeferredValue, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { WorkspaceStateScopeGql } from "../../../core/graphql/generated/schema-types";
import { cn } from "../../../shared/ui/cn";
import { useConversation } from "../../conversations/api/useConversation";
import {
  useWorkspaceState,
  useWorkspaceStateList,
} from "../../workspace-state/api/useWorkspaceState";
import { stateKeyProblem } from "../../workspace-state/stateKeyRules";
import { CLEARED_FIELD, type ArgumentPicker } from "../runtime/argumentPickers";
import { isTimeFieldKind } from "../runtime/timeChoices";
import {
  decodeStateValue,
  encodeStateValue,
  kindOfStoredValue,
  shortStateValue,
  stateValueInputProblem,
  STATE_VALUE_KINDS,
  type StateValueInput,
  type StateValueKind,
} from "../runtime/stateValueKinds";
import {
  CONTROL_CLASS,
  emptyPresetLabel,
  formConversationId,
  selectPropsOf,
  useFieldWorkspace,
  type ControlProps,
} from "./argumentControlParts";
import { ChoiceSelect } from "./ChoiceSelect";
import { ConversationPoolSelect } from "./ConversationArgumentFields";
import { EmojiField } from "./EmojiArgumentField";
import { MemberPoolField } from "./MemberArgumentFields";
import { useMacroTargets, usePipelineTargets } from "./paletteTargets";
import { TimeChoiceField } from "./TimeArgumentFields";

/** The most keys the key field suggests at once. */
const MAX_SUGGESTIONS = 50;

/** The state scope the form's `scope` field picks; the workspace's when it picks none. */
function scopeOf(props: ControlProps): WorkspaceStateScopeGql {
  return props.formValues.scope === "user"
    ? WorkspaceStateScopeGql.USER
    : WorkspaceStateScopeGql.SERVER;
}

/**
 * The state keys in the form's scope, and the entry of `key` when it is one: from the list,
 * else asked for on its own once `key` keeps the key rules.
 */
function useStateEntry(props: ControlProps, key: string) {
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const scope = scopeOf(props);
  const list = useWorkspaceStateList(workspaceId, "", scope);
  const entries = list.data ?? [];
  const listed = entries.find((entry) => entry.key === key);
  const deferredKey = useDeferredValue(key);
  const lookUp =
    !listed && !list.isPending && stateKeyProblem(deferredKey, { allowSystem: true }) === null
      ? deferredKey
      : undefined;
  const single = useWorkspaceState(workspaceId, lookUp, scope);
  const entry = listed ?? (single.data && single.data.key === key ? single.data : undefined);
  return {
    entries,
    entry,
    isPending: list.isPending || (lookUp !== undefined && single.isPending),
  };
}

/** What the key field says under itself: the rule a key breaks, or that the key is new. */
function keyNote(
  picker: ArgumentPicker,
  key: string,
  known: boolean,
  isPending: boolean,
): { text: string; problem: boolean } | null {
  if (key === "") return null;
  const problem = stateKeyProblem(key, { allowSystem: picker.keyAccess === "read" });
  if (problem) return { text: problem, problem: true };
  if (known || isPending) return null;
  return picker.keyAccess === "write"
    ? { text: "New key", problem: false }
    : { text: "Not a key in this workspace yet", problem: false };
}

/**
 * A workspace state key: a text box that suggests the keys in the scope the form picks, each
 * with its current value, and takes a key not among them. With `stateKey` the key is checked
 * against the key rules as it is typed; with `statePrefix` any text is taken.
 */
function StateKeyField(props: ControlProps & { picker: ArgumentPicker }) {
  const { value, onChange, controlId, describedBy, invalid, autoFocus, mode, argument, picker } =
    props;
  const text = typeof value === "string" ? value : "";
  const needle = text.trim();
  const { entries, entry, isPending } = useStateEntry(props, needle);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = `${controlId}-keys`;
  const noteId = `${controlId}-note`;
  const matches = entries
    .filter((candidate) => candidate.key.includes(needle))
    .slice(0, MAX_SUGGESTIONS);
  const showList = open && matches.length > 0;
  const note =
    picker.kind === "stateKey" ? keyNote(picker, needle, Boolean(entry), isPending) : null;

  function pick(key: string) {
    onChange(key);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActive((current) => Math.min(current + 1, matches.length - 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
        return;
      case "Enter":
        if (showList && active >= 0 && matches[active]) {
          event.preventDefault();
          pick(matches[active].key);
        }
        return;
      case "Escape":
        if (showList) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setActive(-1);
        }
        return;
    }
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          id={controlId}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={
            [describedBy, note ? noteId : null].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={invalid || note?.problem || undefined}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={mode === "preset" ? emptyPresetLabel(argument) : undefined}
          autoFocus={autoFocus}
          className={CONTROL_CLASS}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Keys"
          hidden={!showList}
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-rim-line bg-rim-panel py-1 shadow-lg"
        >
          {matches.map((candidate, index) => (
            <li
              key={candidate.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(candidate.key)}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1 text-sm",
                index === active ? "bg-rim-accent/20 text-rim-text" : "text-rim-text-muted",
              )}
            >
              <span className="truncate font-mono text-rim-text">{candidate.key}</span>
              <span className="truncate text-xs text-rim-text-faint">
                {shortStateValue(candidate.value, 40)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {note && (
        <p
          id={noteId}
          className={cn("text-xs", note.problem ? "text-rim-danger" : "text-rim-text-faint")}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/** The text a field of `kind` keeps when the kind is changed to `next`. */
function inputForKind(current: StateValueInput, next: StateValueKind): string {
  if (current.kind === "boolean" || next === "boolean") return "";
  return current.input;
}

/**
 * The value `state.set` stores: a kind (Text, Number, Yes/No, JSON), then a field for it, and
 * the key's current value under it. The kind starts as the saved value's, else as the current
 * value's, else Text. Each kind sends JSON, so text stays text whatever it reads.
 */
function StateValueField(props: ControlProps) {
  const { value, onChange, controlId, describedBy, invalid, autoFocus, mode, argument } = props;
  const sent = typeof value === "string" ? value : "";
  const key = typeof props.formValues.key === "string" ? props.formValues.key.trim() : "";
  const { entry } = useStateEntry(props, key);
  const [state, setState] = useState<StateValueInput | null>(() =>
    sent === "" ? null : decodeStateValue(sent),
  );
  const kind = state?.kind ?? (entry ? kindOfStoredValue(entry.value) : "text");
  const input = state?.input ?? "";
  const liveProblem = invalid ? null : stateValueInputProblem(kind, input);
  const noteId = `${controlId}-note`;
  const nowId = `${controlId}-now`;
  const described =
    [describedBy, liveProblem ? noteId : null, entry ? nowId : null].filter(Boolean).join(" ") ||
    undefined;

  function update(next: StateValueInput) {
    setState(next);
    onChange(encodeStateValue(next.kind, next.input));
  }

  const common = {
    id: controlId,
    "aria-describedby": described,
    "aria-invalid": invalid || Boolean(liveProblem) || undefined,
    autoFocus,
    className: CONTROL_CLASS,
  };
  const field = (() => {
    switch (kind) {
      case "boolean":
        return (
          <ChoiceSelect
            {...selectPropsOf(props)}
            describedBy={described}
            value={input}
            onChange={(next) => update({ kind, input: next })}
            options={[
              { value: "true", label: "Yes" },
              { value: "false", label: "No" },
            ]}
            emptyLabel={mode === "preset" ? emptyPresetLabel(argument) : "Choose…"}
          />
        );
      case "json":
        return (
          <textarea
            {...common}
            rows={3}
            spellCheck={false}
            value={input}
            onChange={(e) => update({ kind, input: e.target.value })}
            placeholder={'{"a": 1}'}
            className={cn(CONTROL_CLASS, "font-mono text-xs")}
          />
        );
      default:
        return (
          <input
            {...common}
            type="text"
            inputMode={kind === "number" ? "decimal" : undefined}
            value={input}
            onChange={(e) => update({ kind, input: e.target.value })}
            placeholder={mode === "preset" ? emptyPresetLabel(argument) : undefined}
          />
        );
    }
  })();

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <select
          aria-label={`${argument.title || argument.name}: kind`}
          value={kind}
          onChange={(e) => {
            const next = e.target.value as StateValueKind;
            update({ kind: next, input: inputForKind({ kind, input }, next) });
          }}
          className={cn(CONTROL_CLASS, "w-28 shrink-0")}
        >
          {STATE_VALUE_KINDS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="min-w-0 flex-1">{field}</div>
      </div>
      {liveProblem && (
        <p id={noteId} className="text-xs text-rim-danger">
          {liveProblem}
        </p>
      )}
      {entry && (
        <p id={nowId} className="text-xs text-rim-text-faint">
          Now: <span className="font-mono">{shortStateValue(entry.value)}</span>
        </p>
      )}
    </div>
  );
}

/** A select over `items`, one of the person's macros or the workspace's pipelines. */
function TargetSelect({
  props,
  items,
  isPending,
  prompt,
}: {
  props: ControlProps;
  items: { id: string; label: string }[];
  isPending: boolean;
  prompt: string;
}) {
  return (
    <ChoiceSelect
      {...selectPropsOf(props)}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={props.onChange}
      options={items.map((item) => ({ value: item.id, label: item.label }))}
      emptyLabel={props.mode === "preset" ? "Ask when run" : isPending ? "Loading…" : prompt}
    />
  );
}

/** One of the person's macros. */
function MacroSelect(props: ControlProps) {
  const { items, isPending } = useMacroTargets();
  return <TargetSelect props={props} items={items} isPending={isPending} prompt="Choose a macro" />;
}

/** One of the open workspace's pipelines. */
function PipelineSelect(props: ControlProps) {
  const { items, isPending } = usePipelineTargets();
  return (
    <TargetSelect props={props} items={items} isPending={isPending} prompt="Choose a pipeline" />
  );
}

/**
 * Text with a box that clears it: while the box is ticked the text is set aside and the field
 * sends an empty string. In the ask form a topic field starts with the conversation's topic.
 */
function ClearableTextField(props: ControlProps & { picker: ArgumentPicker }) {
  const { value, onChange, controlId, describedBy, invalid, autoFocus, mode, argument, picker } =
    props;
  const cleared = value === CLEARED_FIELD;
  const text = typeof value === "string" ? value : "";
  const lastText = useRef(text);
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const conversationId = formConversationId(props);
  const { data: conversation } = useConversation(
    mode === "ask" ? workspaceId : undefined,
    conversationId,
  );
  const topic = conversation?.topic;
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || mode !== "ask" || topic === undefined) return;
    seeded.current = true;
    if (value === "" && topic) {
      lastText.current = topic;
      onChange(topic);
    }
  }, [mode, topic, value, onChange]);

  return (
    <div className="space-y-1.5">
      <input
        id={controlId}
        type="text"
        value={text}
        disabled={cleared}
        onChange={(e) => {
          lastText.current = e.target.value;
          onChange(e.target.value);
        }}
        placeholder={mode === "preset" && !cleared ? emptyPresetLabel(argument) : undefined}
        autoFocus={autoFocus}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL_CLASS, "disabled:opacity-50")}
      />
      <label className="flex items-center gap-1.5 text-xs text-rim-text-muted">
        <input
          type="checkbox"
          checked={cleared}
          onChange={(e) => onChange(e.target.checked ? CLEARED_FIELD : lastText.current)}
          className="accent-rim-accent"
        />
        {picker.clearLabel ?? "Clear it"}
      </label>
    </div>
  );
}

/**
 * The field `picker` names for an argument, or `null` when the argument's type gives its field.
 */
export function PickerControl(props: ControlProps & { picker: ArgumentPicker }) {
  const kind = props.picker.kind;
  if (isTimeFieldKind(kind)) return <TimeChoiceField {...props} kind={kind} />;
  switch (kind) {
    case "stateKey":
    case "statePrefix":
      return <StateKeyField {...props} />;
    case "stateValue":
      return <StateValueField {...props} />;
    case "macro":
      return <MacroSelect {...props} />;
    case "pipeline":
      return <PipelineSelect {...props} />;
    case "clearableText":
      return <ClearableTextField {...props} />;
    case "members":
    case "member":
      return <MemberPoolField {...props} />;
    case "conversation":
      return <ConversationPoolSelect {...props} />;
    case "emoji":
      return <EmojiField {...props} />;
    default:
      return null;
  }
}
