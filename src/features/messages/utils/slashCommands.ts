import { agentAvailable } from "../../agent/agentAvailability";
import { useAgentStore } from "../../agent/state/useAgentStore";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { CommandDefinition } from "../../commands/types";
import { fetchMacroByName, type Macro } from "../../macros/api/useMacros";
import { accountMacrosOn, fetchAccountMacros } from "../../macros/api/useAccountMacros";
import { runLegacyMacro } from "../../macros/runtime/runLegacyMacro";
import { runMacro } from "../../macros/runtime/runMacro";
import { toast } from "../../../shared/toast";

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  placeholder?: string;
  handler?: (args: string) => void;
}

/** Runs the person's macro whose title is `name`, whatever its letter case. */
async function runMacroNamed(name: string): Promise<void> {
  let macro;
  try {
    const wanted = name.toLowerCase();
    macro = (await fetchAccountMacros()).find((m) => m.title.trim().toLowerCase() === wanted);
  } catch (err: unknown) {
    toast.error(`Your macros could not be read: ${graphqlErrorMessage(err, "unknown error")}`);
    return;
  }
  if (!macro) {
    toast.error(`Macro not found: "${name}"`);
    return;
  }
  await runMacro(macro.id);
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/agent",
    label: "Ask the assistant",
    description: "Ask the assistant a question about your workspace",
    placeholder: "What would you like to know?",
    handler: (args: string) => useAgentStore.getState().open(args),
  },
  {
    command: "/macro",
    label: "Run Macro",
    description: "Run one of your macros by its name",
    placeholder: "Macro name",
    handler: (args: string) => {
      const macroName = args.trim();
      if (!macroName) return;
      if (accountMacrosOn()) {
        void runMacroNamed(macroName);
        return;
      }
      const workspaceId = useWorkspaceStore.getState().workspaceId;
      if (!workspaceId) {
        toast.error("No workspace selected");
        return;
      }

      void (async () => {
        let macro: Macro | null;
        try {
          macro = await fetchMacroByName(workspaceId, macroName);
        } catch (err: unknown) {
          toast.error(`Failed to execute macro: ${graphqlErrorMessage(err, "unknown error")}`);
          return;
        }
        if (!macro) {
          toast.error(`Macro not found: "${macroName}"`);
          return;
        }
        const commands = queryClient.getQueryData<CommandDefinition[]>(
          queryKeys.commands("PALETTE", workspaceId),
        );
        await runLegacyMacro(macro, workspaceId, commands);
      })();
    },
  },
];

export function getSlashCommandSuggestions(partial: string): SlashCommand[] {
  const lower = partial.toLowerCase();
  return SLASH_COMMANDS.filter(
    (cmd) => cmd.command.startsWith(lower) && (cmd.command !== "/agent" || agentAvailable()),
  );
}

export function isSlashCommand(text: string): SlashCommand | null {
  const commandPart = text.split(" ")[0].toLowerCase();
  return SLASH_COMMANDS.find((cmd) => cmd.command === commandPart) ?? null;
}
