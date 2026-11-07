/**
 * The settings of the boxes that have them, read from a stored layout. The server checks only
 * that settings are an object, so each reader returns `null` for settings this app cannot use,
 * and Home asks for them to be fixed instead of guessing.
 */

/** How many messages or conversations a box shows. */
export type BoxCount = 3 | 5 | 10;

/** The counts a box can show, in the order the settings offer them. */
export const BOX_COUNTS: readonly BoxCount[] = [3, 5, 10];

/** The count a new box shows. */
export const DEFAULT_COUNT: BoxCount = 5;

/** The most actions a Quick actions box holds. */
export const MAX_QUICK_ACTIONS = 6;

/** The most bytes an action's preset arguments take as JSON, as for a personal keybind. */
export const MAX_PRESET_ARGS_BYTES = 4096;

/** The command an action may never run: editing Home is not a command for automation. */
export const EDIT_HOME_COMMAND = "workspace.edit_home";

/** A channel box: one channel of one workspace and how many of its latest messages show. */
export interface ChannelSettings {
  workspaceId: string;
  conversationId: string;
  count: BoxCount;
}

/** A Direct messages box: how many conversations show. */
export interface DirectSettings {
  count: BoxCount;
}

/** One button of a Quick actions box: a command and the arguments it runs with. */
export interface QuickAction {
  commandId: string;
  presetArgs?: Record<string, unknown>;
}

/** A Quick actions box: 1 to 6 actions. */
export interface QuickSettings {
  actions: QuickAction[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** `value` as a box count, or `null` when it is not 3, 5 or 10. */
export function readCount(value: unknown): BoxCount | null {
  return BOX_COUNTS.find((count) => count === value) ?? null;
}

/** A channel box's settings, or `null` when they are missing or of the wrong shape. */
export function readChannelSettings(settings: unknown): ChannelSettings | null {
  if (!isRecord(settings)) return null;
  const count = readCount(settings.count);
  if (!isId(settings.workspaceId) || !isId(settings.conversationId) || count === null) return null;
  return { workspaceId: settings.workspaceId, conversationId: settings.conversationId, count };
}

/** A Direct messages box's settings, or `null` when they are missing or of the wrong shape. */
export function readDirectSettings(settings: unknown): DirectSettings | null {
  if (!isRecord(settings)) return null;
  const count = readCount(settings.count);
  return count === null ? null : { count };
}

/**
 * Why `args` cannot be an action's preset arguments, or `null` when they can: a JSON object of at
 * most {@link MAX_PRESET_ARGS_BYTES} bytes.
 */
export function presetArgsProblem(args: unknown): string | null {
  if (!isRecord(args)) return "Arguments must be a JSON object, such as {}";
  const bytes = new TextEncoder().encode(JSON.stringify(args)).length;
  if (bytes > MAX_PRESET_ARGS_BYTES) {
    return `Arguments must be at most ${MAX_PRESET_ARGS_BYTES} bytes`;
  }
  return null;
}

/** A Quick actions box's settings, or `null` when they are missing or of the wrong shape. */
export function readQuickSettings(settings: unknown): QuickSettings | null {
  if (!isRecord(settings) || !Array.isArray(settings.actions)) return null;
  const actions = settings.actions;
  if (actions.length < 1 || actions.length > MAX_QUICK_ACTIONS) return null;
  const read: QuickAction[] = [];
  for (const action of actions) {
    if (!isRecord(action) || !isId(action.commandId)) return null;
    if (action.presetArgs === undefined) {
      read.push({ commandId: action.commandId });
      continue;
    }
    if (presetArgsProblem(action.presetArgs)) return null;
    read.push({
      commandId: action.commandId,
      presetArgs: action.presetArgs as Record<string, unknown>,
    });
  }
  return { actions: read };
}
