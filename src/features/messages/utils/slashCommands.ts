import { useAgentStore } from "../../agent/state/useAgentStore";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { CommandDefinition } from "../../commands/types";
import { fetchMacroByName, type Macro } from "../../macros/api/useMacros";
import { runMacro } from "../../macros/runtime/runMacro";
import { toast } from "../../../shared/toast";

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  placeholder?: string;
  handler?: (args: string) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/agent",
    label: "Ask AI Agent",
    description: "Ask the AI agent a question about your workspace",
    placeholder: "What would you like to know?",
    handler: (args: string) => useAgentStore.getState().open(args),
  },
  {
    command: "/macro",
    label: "Run Macro",
    description: "Execute a saved macro by name",
    placeholder: "Macro name",
    handler: (args: string) => {
      const macroName = args.trim();
      if (!macroName) return;
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
        await runMacro(macro, workspaceId, commands);
      })();
    },
  },
];

export function getSlashCommandSuggestions(partial: string): SlashCommand[] {
  const lower = partial.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(lower));
}

export function isSlashCommand(text: string): SlashCommand | null {
  const commandPart = text.split(" ")[0].toLowerCase();
  return SLASH_COMMANDS.find((cmd) => cmd.command === commandPart) ?? null;
}
