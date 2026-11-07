import type { PipelineActionGql } from "../../core/graphql/generated/schema-types";

/** The command a Post as bot action runs, which the server asks for beside `postAsBot`. */
export const POST_AS_BOT_COMMAND = "chat.post_message";

/** The value of `actionType` on a Post as bot action. */
const POST_AS_BOT_TYPE = "PostAsBot";

/** What a Post as bot action posts, as who and where. */
export interface PostAsBot {
  botUserId: string;
  conversationId: string;
  /** The text as saved, with its placeholders. */
  text: string;
}

function stringField(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

/**
 * The Post as bot action `action` is, from `postAsBot` or, where the listing did not ask for that
 * field, from the `args` the server fills in for such a listing. Reading it here keeps those ids
 * out of the command form, which shows `args` as they are.
 *
 * @param action - An action of a listed pipeline.
 * @returns The action's parts, empty where they cannot be read, or `null` for any other action.
 */
export function postAsBotOf(
  action: Pick<PipelineActionGql, "actionType" | "args"> & {
    postAsBot?: PipelineActionGql["postAsBot"];
  },
): PostAsBot | null {
  if (action.postAsBot) return action.postAsBot;
  if (action.actionType !== POST_AS_BOT_TYPE) return null;
  const args: Record<string, unknown> =
    typeof action.args === "object" && action.args !== null
      ? (action.args as Record<string, unknown>)
      : {};
  return {
    botUserId: stringField(args, "bot_user_id"),
    conversationId: stringField(args, "conversation_id"),
    text: stringField(args, "text"),
  };
}
