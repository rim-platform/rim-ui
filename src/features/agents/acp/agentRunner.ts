/**
 * The agent runner's commands and events (`src-tauri/src/agent_runner`): starting agent programs
 * on this computer, writing lines to their stdin and hearing their stdout lines and their end.
 * Every function throws an `Error` whose message the UI can show: the runner's own sentence, or
 * {@link DESKTOP_ONLY_MESSAGE} off the desktop app.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { logger } from "../../../core/logger";

/** The event with one stdout line of a run. */
export const AGENT_RUN_LINE_EVENT = "agent-runner://line";
/** The event that says a run has ended. */
export const AGENT_RUN_EXIT_EVENT = "agent-runner://exit";
/** The message of every function's error off the desktop app. */
export const DESKTOP_ONLY_MESSAGE = "Starting agents needs the desktop app";

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

/** Throws the off-desktop error when there is no desktop app to ask. */
function requireDesktop(): void {
  if (!isTauri()) throw new Error(DESKTOP_ONLY_MESSAGE);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  requireDesktop();
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(typeof error === "string" ? error : JSON.stringify(error), { cause: error });
  }
}

/**
 * Starts an agent program, without a shell.
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

/** @returns The runs that are running, oldest first. */
export function listAgentRuns(): Promise<AgentRunInfo[]> {
  return call("agent_runner_list");
}

/** Listens for `event` and returns a function that stops listening, also before it started. */
function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  requireDesktop();
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void listen<T>(event, (e) => {
    if (!stopped) callback(e.payload);
  }).then(
    (stop) => {
      if (stopped) stop();
      else unlisten = stop;
    },
    (error: unknown) => {
      logger.warn(`[RIM:agents] could not listen for ${event}:`, error);
    },
  );
  return () => {
    stopped = true;
    unlisten?.();
    unlisten = undefined;
  };
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
