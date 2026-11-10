import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { FieldValue, FieldValues } from "../runtime/argumentValues";
import type { CommandArgumentInfo } from "../types";

/**
 * The form a field is in: `ask` fills in a command about to run, `preset` saves arguments with a
 * keybind or quick action, where an empty field is asked for, or left to its default, when the
 * command runs.
 */
export type ArgumentFormMode = "ask" | "preset";

/** The classes of a text box, a select and a text area in the argument form. */
export const CONTROL_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent aria-[invalid=true]:border-rim-danger";

/** What every control of one argument is given. */
export interface ControlProps {
  argument: CommandArgumentInfo;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  mode: ArgumentFormMode;
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  autoFocus: boolean;
  workspaceId: string | undefined;
  /** The command the argument is of, which picks the field for some arguments. */
  commandId: string | undefined;
  /** What the form's fields hold now, for a field that follows another, such as a scope. */
  formValues: Readonly<FieldValues>;
  onSubmit?: () => void;
}

/** What an empty preset field does when the command runs. */
export function emptyPresetLabel(argument: CommandArgumentInfo): string {
  return argument.required ? "Ask when run" : "Default";
}

/** The props every select passes on from its field. */
export function selectPropsOf(props: ControlProps) {
  return {
    controlId: props.controlId,
    describedBy: props.describedBy,
    invalid: props.invalid,
    autoFocus: props.autoFocus,
  };
}

/** The empty option of a select: what an empty preset does, or a prompt to choose. */
export function selectEmptyLabel(
  argument: CommandArgumentInfo,
  mode: ArgumentFormMode,
  prompt: string,
): string {
  return mode === "preset" ? emptyPresetLabel(argument) : prompt;
}

/** The workspace a field offers things of: the one given, else the open one. */
export function useFieldWorkspace(workspaceId: string | undefined): string | undefined {
  const open = useWorkspaceStore((s) => s.workspaceId) ?? undefined;
  return workspaceId ?? open;
}

/** The conversation the form's `conversation_id` field holds, or the one the command runs in. */
export function formConversationId(props: Pick<ControlProps, "formValues">): string | undefined {
  const value = props.formValues.conversation_id;
  return typeof value === "string" && value !== "" ? value : undefined;
}
