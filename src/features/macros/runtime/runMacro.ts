import { graphqlClient } from "../../../core/graphql/client";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import type { CommandDefinition } from "../../commands/types";
import {
  runWithHumanConfirmation,
  strictestSensitivity,
} from "../../commands/runtime/humanConfirmation";
import {
  ExecuteMacroDocument,
  type ExecuteMacroResult,
  type ExecuteMacroVariables,
  type Macro,
} from "../api/useMacros";

/**
 * Runs a saved macro for the user and toasts how it went. The server holds a macro with a
 * dangerous step until the user confirms it in the confirmation dialog. `commands` is the
 * registry the dialog reads step sensitivities from.
 */
export async function runMacro(
  macro: Pick<Macro, "id" | "name" | "steps">,
  workspaceId: string,
  commands: readonly CommandDefinition[] | undefined,
): Promise<void> {
  const stepIds = macro.steps.map((step) => step.commandId);
  try {
    const outcome = await runWithHumanConfirmation(
      async (confirmation) => {
        const input: ExecuteMacroVariables = {
          macroId: macro.id,
          commandContext: { workspaceId },
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
