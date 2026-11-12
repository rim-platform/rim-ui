/**
 * Signing in to an agent program: asking it, in a short run of its own, which ways it offers,
 * then opening its sign-in in a terminal, or asking it to sign in itself. What the person types
 * in the terminal or the browser stays with the agent; RIM never sees it.
 */

import { homeDir } from "@tauri-apps/api/path";

import type { AgentProgramProfile } from "../state/useAgentProgramsStore";
import { AcpClient, type AuthMethod } from "./acpClient";
import { openAcpConnection, type AcpConnection } from "./acpConnection";
import { findPreset } from "./acpPresets";
import { openAgentTerminal, type AgentTerminalOutcome } from "./agentRunner";
import { ADD_AGAIN } from "./agentSession";

/** One way of signing in, as the sign-in dialog offers it. */
export type SignInWay =
  | {
      kind: "terminal";
      method: AuthMethod;
      /** All the arguments the terminal starts the program with. */
      args: string[];
      env: Record<string, string>;
    }
  | {
      kind: "terminal_refused";
      method: AuthMethod;
      /** Why RIM won't open it, as a sentence. */
      reason: string;
    }
  | { kind: "agent"; method: AuthMethod }
  | { kind: "env_var"; method: AuthMethod }
  | { kind: "setup"; args: string[] }
  | { kind: "other"; method: AuthMethod };

/**
 * Environment variables RIM does not let an agent set for its terminal: they change where
 * programs are found, what is loaded into them, which shell starts, and which proxy and
 * certificates are trusted.
 */
const UNSAFE_ENV = [
  /^PATH$/iu,
  /^PATHEXT$/iu,
  /^LD_/iu,
  /^DYLD_/iu,
  /^NODE_OPTIONS$/iu,
  /^NODE_PATH$/iu,
  /^NODE_EXTRA_CA_CERTS$/iu,
  /^PYTHON(PATH|HOME|STARTUP)$/iu,
  /^PERL5?LIB$/iu,
  /^RUBYOPT$/iu,
  /^BASH_ENV$/iu,
  /^ENV$/iu,
  /^ZDOTDIR$/iu,
  /^SHELL$/iu,
  /^COMSPEC$/iu,
  /_PROXY$/iu,
  /^SSL_CERT_(FILE|DIR)$/iu,
  /^(REQUESTS|CURL)_CA_BUNDLE$/iu,
];

/** @returns The names in `env` an agent may not set. */
export function unsafeEnvNames(env: Record<string, string>): string[] {
  return Object.keys(env).filter((name) => UNSAFE_ENV.some((pattern) => pattern.test(name)));
}

/** Whether the program re-reads its arguments as a command line, as a Windows batch file does. */
function reparsesArguments(program: string): boolean {
  return /\.(bat|cmd)$/iu.test(program);
}

/**
 * The ways to sign in to a profile's agent, from the methods it named.
 *
 * @param profile - The profile, with its program's full path.
 * @param methods - The agent's `authMethods`.
 * @returns The ways, in the agent's order; with no methods, the preset's own setup in a
 *   terminal when it has one, otherwise none.
 */
export function signInWays(
  profile: Pick<AgentProgramProfile, "args" | "presetId" | "resolvedProgram">,
  methods: readonly AuthMethod[],
): SignInWay[] {
  const program = profile.resolvedProgram ?? "";
  if (methods.length === 0) {
    const setupArgs = findPreset(profile.presetId)?.setupArgs ?? null;
    return setupArgs !== null && !reparsesArguments(program)
      ? [{ kind: "setup", args: [...setupArgs] }]
      : [];
  }
  return methods.map((method): SignInWay => {
    switch (method.type) {
      case "terminal": {
        const unsafe = unsafeEnvNames(method.env);
        if (unsafe.length > 0) {
          return {
            kind: "terminal_refused",
            method,
            reason: `It would change ${unsafe.join(", ")}, which RIM doesn't let an agent set.`,
          };
        }
        if (reparsesArguments(program)) {
          return {
            kind: "terminal_refused",
            method,
            reason: "RIM can't pass arguments safely to this kind of program.",
          };
        }
        return {
          kind: "terminal",
          method,
          args: [...profile.args, ...method.args],
          env: method.env,
        };
      }
      case "agent":
        return { kind: "agent", method };
      case "env_var":
        return { kind: "env_var", method };
      default:
        return { kind: "other", method };
    }
  });
}

/**
 * Opens the computer's terminal running the profile's program for a terminal way, after the
 * native dialog.
 *
 * @returns What became of it.
 */
export function openSignInTerminal(
  profile: Pick<AgentProgramProfile, "resolvedProgram">,
  way: Extract<SignInWay, { kind: "terminal" | "setup" }>,
): Promise<AgentTerminalOutcome> {
  if (profile.resolvedProgram === null) return Promise.reject(new Error(ADD_AGAIN));
  return openAgentTerminal({
    program: profile.resolvedProgram,
    args: way.args,
    env: way.kind === "terminal" ? way.env : {},
  });
}

/** What a sign-in probe reaches outside itself; tests replace these. */
export interface SignInProbeDeps {
  openConnection: typeof openAcpConnection;
  homeFolder: () => Promise<string>;
}

const DEFAULT_DEPS: SignInProbeDeps = { openConnection: openAcpConnection, homeFolder: homeDir };

/**
 * A short run of an agent program, only to ask how to sign in and to sign in with a way the
 * agent handles itself. It opens no session.
 */
export class SignInProbe {
  private constructor(
    private readonly connection: AcpConnection,
    private readonly client: AcpClient,
    /** The agent's sign-in methods. */
    readonly methods: readonly AuthMethod[],
  ) {}

  /**
   * Starts the profile's program in its default folder, or the home folder, and introduces RIM.
   *
   * @returns The probe, with the agent's methods. Rejects with a sentence when it could not
   *   start or answer, after stopping it.
   */
  static async open(
    profile: AgentProgramProfile,
    deps: Partial<SignInProbeDeps> = {},
  ): Promise<SignInProbe> {
    const { openConnection, homeFolder } = { ...DEFAULT_DEPS, ...deps };
    if (profile.resolvedProgram === null) throw new Error(ADD_AGAIN);
    const cwd = profile.defaultFolder ?? (await homeFolder());
    const connection = await openConnection({
      program: profile.resolvedProgram,
      args: profile.args,
      cwd,
    });
    const client = new AcpClient(connection, {
      onUpdate: () => {},
      onPermission: () => Promise.resolve({ outcome: "cancelled" }),
    });
    try {
      const hello = await client.initialize();
      return new SignInProbe(connection, client, hello.authMethods);
    } catch (error) {
      await connection.stop().catch(() => {});
      throw error;
    }
  }

  /**
   * Asks the agent to sign in with a method it handles itself, and waits while the person
   * finishes in the browser the agent opens.
   *
   * @param methodId - The method.
   */
  authenticate(methodId: string): Promise<void> {
    return this.client.authenticate(methodId);
  }

  /** Stops the program. */
  stop(): Promise<void> {
    return this.connection.stop();
  }
}
