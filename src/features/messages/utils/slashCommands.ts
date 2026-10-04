import { useAgentStore } from "../../agent/state/useAgentStore";
import { graphqlClient } from "../../../core/graphql/client";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { fetchMacroByName, ExecuteMacroDocument } from "../../macros/api/useMacros";
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
        try {
          const macro = await fetchMacroByName(workspaceId, macroName);
          if (!macro) {
            toast.error(`Macro not found: "${macroName}"`);
            return;
          }

          const result = await graphqlClient.request<{
            executeMacro: { status: string; message: string };
          }>(ExecuteMacroDocument, {
            input: {
              macroId: macro.id,
              commandContext: { workspaceId },
            },
          });

          if (result.executeMacro.status === "ERROR") {
            toast.error(`Macro failed: ${result.executeMacro.message}`);
          } else {
            toast.success(`Macro "${macroName}" executed`);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          toast.error(`Failed to execute macro: ${message}`);
        }
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
