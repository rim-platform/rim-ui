/**
 * The agent programs RIM knows how to start. Each one runs the program the person installed;
 * RIM never installs or downloads one, and only shows how to.
 */

/** A hint the person follows in a terminal, with the command to copy when there is one. */
export interface PresetHint {
  text: string;
  /** The command the Copy button copies, or `null`. */
  command: string | null;
}

/** An agent program RIM knows how to start. */
export interface AcpPreset {
  id: "claude-code" | "codex" | "gemini-cli" | "opencode" | "goose";
  name: string;
  /** The bare program name, looked up on the computer's `PATH`. */
  program: string;
  args: string[];
  /** How to install it. */
  install: PresetHint;
  /** How to sign in to it, once. */
  signIn: PresetHint;
}

/** The presets, in the order the Add menu shows them. */
export const ACP_PRESETS: readonly AcpPreset[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    program: "claude-agent-acp",
    args: [],
    install: {
      text: "Install Claude Code's ACP adapter:",
      command: "npm install -g @agentclientprotocol/claude-agent-acp",
    },
    signIn: { text: "Sign in once: run claude in a terminal and log in.", command: "claude" },
  },
  {
    id: "codex",
    name: "Codex",
    program: "codex-acp",
    args: [],
    install: {
      text: "Install Codex's ACP adapter:",
      command: "npm install -g @agentclientprotocol/codex-acp",
    },
    signIn: {
      text: "Sign in once: run codex login in a terminal, or set CODEX_API_KEY.",
      command: "codex login",
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    program: "gemini",
    args: ["--acp"],
    install: { text: "Install Gemini CLI the way its own instructions say.", command: null },
    signIn: { text: "Sign in once: run gemini in a terminal and log in.", command: "gemini" },
  },
  {
    id: "opencode",
    name: "opencode",
    program: "opencode",
    args: ["acp"],
    install: { text: "Install opencode the way its own instructions say.", command: null },
    signIn: {
      text: "Sign in once: run opencode auth login in a terminal.",
      command: "opencode auth login",
    },
  },
  {
    id: "goose",
    name: "Goose",
    program: "goose",
    args: ["acp"],
    install: { text: "Install Goose the way its own instructions say.", command: null },
    signIn: {
      text: "Set it up once: run goose configure in a terminal.",
      command: "goose configure",
    },
  },
];

/** @returns The preset with this id, or `undefined`. */
export function findPreset(id: string | null): AcpPreset | undefined {
  return id === null ? undefined : ACP_PRESETS.find((preset) => preset.id === id);
}

/**
 * The command line as the person reads it: the program and each argument, an argument with
 * spaces or quotes in double quotes.
 */
export function commandLine(program: string, args: readonly string[]): string {
  return [program, ...args]
    .map((part) => (part === "" || /[\s"'\\]/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}
