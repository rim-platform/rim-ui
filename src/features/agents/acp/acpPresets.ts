/**
 * The agents RIM knows how to start. RIM can install each one itself, from the source its
 * installer fixes; one the person installed themselves is started by its bare program name,
 * looked up on the computer's `PATH`.
 */

/** An agent RIM knows how to start. */
export interface AcpPreset {
  id: "claude-code" | "codex" | "gemini-cli" | "opencode" | "goose";
  name: string;
  /** The bare program name of one the person installed, looked up on the computer's `PATH`. */
  program: string;
  args: string[];
  /**
   * The arguments that run the program's own sign-in or setup in a terminal, used when the
   * agent names no way to sign in, or `null`.
   */
  setupArgs: string[] | null;
  /** How to sign in to it, for when RIM can't do it from the agent's own answer. */
  signIn: string;
}

/** The presets, in the order Settings shows them. */
export const ACP_PRESETS: readonly AcpPreset[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    program: "claude-agent-acp",
    args: [],
    setupArgs: null,
    signIn: "Sign in once: run claude in a terminal and log in.",
  },
  {
    id: "codex",
    name: "Codex",
    program: "codex-acp",
    args: [],
    setupArgs: null,
    signIn: "Sign in once: run codex login in a terminal, or set CODEX_API_KEY.",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    program: "gemini",
    args: ["--acp"],
    setupArgs: null,
    signIn: "Sign in once: run gemini in a terminal and log in.",
  },
  {
    id: "opencode",
    name: "opencode",
    program: "opencode",
    args: ["acp"],
    setupArgs: ["auth", "login"],
    signIn: "Sign in once: run opencode auth login in a terminal.",
  },
  {
    id: "goose",
    name: "Goose",
    program: "goose",
    args: ["acp"],
    setupArgs: ["configure"],
    signIn: "Set it up once: run goose configure in a terminal.",
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
