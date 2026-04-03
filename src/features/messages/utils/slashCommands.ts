import { useAgentStore } from "../../agent/state/useAgentStore";

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
];

export function getSlashCommandSuggestions(partial: string): SlashCommand[] {
  const lower = partial.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(lower));
}

export function isSlashCommand(text: string): SlashCommand | null {
  const commandPart = text.split(" ")[0].toLowerCase();
  return SLASH_COMMANDS.find((cmd) => cmd.command === commandPart) ?? null;
}
