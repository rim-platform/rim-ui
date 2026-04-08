import { useAgentStore } from "../../agent/state/useAgentStore";
import { graphqlClient } from "../../../core/graphql/client";
import { gql } from "graphql-request";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  placeholder?: string;
  handler?: (args: string) => void;
}

const ExecuteMacroByName = gql`
  mutation ExecuteMacroSlash($input: ExecuteMacroInput!) {
    executeMacro(input: $input) {
      status
      message
    }
  }
`;

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
      // TODO: Resolve macro name to ID via backend query. For now, use name as ID.
      const workspaceId = useWorkspaceStore.getState().workspaceId;
      graphqlClient.request(ExecuteMacroByName, {
        input: {
          macroId: macroName,
          commandContext: { workspaceId },
        },
      }).catch((err) => {
        console.error("[/macro] Failed to execute macro:", err);
      });
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
