/**
 * The agent runner's commands and events (`src-tauri/src/agent_runner`): starting agent programs
 * on this computer, writing lines to their stdin and hearing their stdout lines and their end,
 * and opening a terminal running one of them.
 * Every function throws an `Error` whose message the UI can show: the runner's own sentence, or
 * {@link DESKTOP_ONLY_MESSAGE} off the desktop app.
 */

import {
  callDesktop as call,
  DESKTOP_ONLY_MESSAGE,
  listenDesktop as subscribe,
} from "./desktopIpc";

export { DESKTOP_ONLY_MESSAGE };

/** The event with one stdout line of a run. */
export const AGENT_RUN_LINE_EVENT = "agent-runner://line";
/** The event that says a run has ended. */
export const AGENT_RUN_EXIT_EVENT = "agent-runner://exit";

/** One line of a run's stdout, without its line break. */
export interface AgentRunLine {
  runId: string;
  line: string;
}

/** Why the runner ended a run; `null` in {@link AgentRunExit} when it exited by itself. */
export type AgentRunExitReason = "stopped" | "line_too_long" | "stdout_failed";

/** How a run ended. */
export interface AgentRunExit {
  runId: string;
  /** The exit code, or `null` when a signal ended it. */
  code: number | null;
  /** The signal that ended it, on Unix. */
  signal: number | null;
  reason: AgentRunExitReason | null;
  /** The last lines of its stderr, oldest first. */
  stderrTail: string[];
}

/** A run that is running. */
export interface AgentRunInfo {
  runId: string;
  /** The program's full path. */
  program: string;
  cwd: string;
  /** When it started, in milliseconds since the Unix epoch. */
  startedAt: number;
}

/** What starts a run. */
export interface StartAgentRunOptions {
  /** A full path, or a bare name looked up on the computer's `PATH`. */
  program: string;
  args: string[];
  /** A full path to an existing folder. */
  cwd: string;
}

/** A program the person allowed, with the exact arguments it may be started with. */
export interface AllowedAgentProgram {
  /** The program's full path. */
  program: string;
  args: string[];
}

/**
 * Asks the person, in a native dialog the page cannot draw or answer, whether a program may be
 * started with exactly these arguments, and remembers the answer Allow. A pair already allowed is
 * allowed without asking.
 *
 * @param program - A full path, or a bare name looked up on the computer's `PATH`.
 * @param args - The exact arguments.
 * @returns Whether the person allowed it.
 */
export async function allowAgentProgram(program: string, args: string[]): Promise<boolean> {
  const answer = await call<{ allowed: boolean }>("agent_runner_allow", { program, args });
  return answer.allowed;
}

/**
 * Removes a program and its exact arguments from the allowed ones, without asking.
 *
 * @param program - The full path, or a bare name looked up on the computer's `PATH`.
 * @param args - The exact arguments.
 */
export async function forgetAgentProgram(program: string, args: string[]): Promise<void> {
  await call<null>("agent_runner_forget", { program, args });
}

/** @returns The allowed programs and their arguments, in the order they were allowed. */
export function allowedAgentPrograms(): Promise<AllowedAgentProgram[]> {
  return call("agent_runner_allowed");
}

/**
 * Starts an agent program, without a shell. The program and exactly these arguments must have
 * been allowed with {@link allowAgentProgram}.
 *
 * @param options - The program, its arguments and its working folder.
 * @returns The new run's id.
 */
export async function startAgentRun(options: StartAgentRunOptions): Promise<string> {
  const started = await call<{ runId: string }>("agent_runner_start", {
    program: options.program,
    args: options.args,
    cwd: options.cwd,
  });
  return started.runId;
}

/**
 * Writes one line and a line break to a run's stdin.
 *
 * @param runId - The run.
 * @param line - The line, without line breaks.
 */
export async function sendAgentLine(runId: string, line: string): Promise<void> {
  await call<null>("agent_runner_send", { runId, line });
}

/**
 * Stops a run: closes its stdin, then signals and finally kills it. Resolves once it has ended;
 * stopping a run that has already ended does nothing.
 *
 * @param runId - The run.
 */
export async function stopAgentRun(runId: string): Promise<void> {
  await call<null>("agent_runner_stop", { runId });
}

/**
 * Looks programs up on the computer's `PATH`.
 *
 * @param names - Bare program names.
 * @returns The full path of each name, or `null` where it was not found, in the same order.
 */
export function findAgentPrograms(names: string[]): Promise<(string | null)[]> {
  return call("agent_runner_find", { names });
}

/** What opening a terminal for an agent program needs. */
export interface AgentTerminalOptions {
  /** An allowed program's full path, exactly as the allowed list holds it. */
  program: string;
  args: string[];
  /** Environment variables to set for it, on top of RIM's own. */
  env: Record<string, string>;
}

/**
 * What became of opening a terminal: `opened`, `declined` in the native dialog, or
 * `noTerminal` when the computer has no terminal RIM can open, with the command line to run in
 * one.
 */
export type AgentTerminalOutcome =
  { kind: "opened" } | { kind: "declined" } | { kind: "noTerminal"; commandLine: string };

/**
 * Opens the computer's terminal running an allowed agent program with these arguments, after
 * the person agrees in a native dialog that shows the command line. RIM does not see what
 * happens in the terminal.
 *
 * @param options - The program, its arguments and the variables to set.
 * @returns Whether it opened, was declined, or found no terminal.
 */
export function openAgentTerminal(options: AgentTerminalOptions): Promise<AgentTerminalOutcome> {
  return call("agent_runner_open_terminal", {
    program: options.program,
    args: options.args,
    env: options.env,
  });
}

/**
 * Asks the person to choose a folder for an agent to work in, in the system's folder dialog.
 *
 * @param start - The folder the dialog opens at, when it is one, or `null`.
 * @returns The folder's full path, or `null` when the person cancelled.
 */
export function pickAgentFolder(start: string | null): Promise<string | null> {
  return call("agent_runner_pick_folder", { start });
}

/** @returns The runs that are running, oldest first. */
export function listAgentRuns(): Promise<AgentRunInfo[]> {
  return call("agent_runner_list");
}

/**
 * Calls `callback` with each stdout line of every run.
 *
 * @returns A function that stops listening.
 */
export function onAgentRunLine(callback: (line: AgentRunLine) => void): () => void {
  return subscribe(AGENT_RUN_LINE_EVENT, callback);
}

/**
 * Calls `callback` when any run ends, after its last line.
 *
 * @returns A function that stops listening.
 */
export function onAgentRunExit(callback: (exit: AgentRunExit) => void): () => void {
  return subscribe(AGENT_RUN_EXIT_EVENT, callback);
}
