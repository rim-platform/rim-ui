import { graphqlClient } from "../../../core/graphql/client";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import type { CommandContextInput, CommandDefinition } from "../../commands/types";
import { currentCommandContext } from "../../commands/runtime/commandContext";
import {
  runWithHumanConfirmation,
  strictestSensitivity,
} from "../../commands/runtime/humanConfirmation";
import {
  ExecuteMacroDocument,
  type ExecuteMacroResult,
  type ExecuteMacroInput,
  type Macro,
} from "../api/useMacros";

/**
 * The context a macro run sends, which the server hands to every step.
 *
 * @param workspaceId - The workspace the macro runs in.
 * @returns The selected workspace's open conversation, open thread and focused surface when
 *   `workspaceId` is the selected workspace; only `workspaceId` otherwise.
 */
function macroContext(workspaceId: string): CommandContextInput {
  const current = currentCommandContext();
  return current.workspaceId === workspaceId ? current : { workspaceId };
}

/**
 * Runs a saved macro for the user and toasts how it went. The server holds a macro with a
 * dangerous step until the user confirms it in the confirmation dialog; the confirmed run sends
 * the context the first call sent, read once when the run starts. `commands` is the registry
 * the dialog reads step sensitivities from.
 */
export async function runMacro(
  macro: Pick<Macro, "id" | "name" | "steps">,
  workspaceId: string,
  commands: readonly CommandDefinition[] | undefined,
): Promise<void> {
  const stepIds = macro.steps.map((step) => step.commandId);
  const commandContext = macroContext(workspaceId);
  try {
    const outcome = await runWithHumanConfirmation(
      async (confirmation) => {
        const input: ExecuteMacroInput = {
          macroId: macro.id,
          commandContext,
          ...(confirmation && { confirmation }),
        };
        const res = await graphqlClient.request<{ executeMacro: ExecuteMacroResult }>(
          ExecuteMacroDocument,
          { input },
        );
        return res.executeMacro;
      },
      {
        commandId: "macro.run",
        title: `Run macro "${macro.name}"`,
        description:
          "This macro includes commands marked as dangerous. They may delete data or make irreversible changes.",
        args: { steps: stepIds.join(", ") },
        ...strictestSensitivity(stepIds, commands),
      },
    );
    switch (outcome.kind) {
      case "completed":
        if (outcome.result.status === "SUCCESS") {
          toast.success(`Macro "${macro.name}" executed`);
        } else {
          toast.error(`Macro failed: ${outcome.result.message || "unknown error"}`);
        }
        return;
      case "unconfirmed":
        toast.error(`Macro failed: ${outcome.message}`);
        return;
      case "cancelled":
      case "stale":
        return;
    }
  } catch (err) {
    toast.error(`Failed to execute macro: ${graphqlErrorMessage(err, "unknown error")}`);
  }
}
