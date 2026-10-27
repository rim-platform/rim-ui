import type { CommandDefinition } from "../types";
import { runsOnServer } from "./serverRunnable";
import { strictestSensitivity, type ConfirmationSubject } from "./humanConfirmation";

type StageCommand = Pick<
  CommandDefinition,
  "id" | "title" | "executionTarget" | "dangerous" | "sensitivity"
>;

/** The command id a pipe stage names: its text up to the first space. */
export function pipeStageCommandId(segment: string): string {
  return segment.trim().split(/\s+/)[0] ?? "";
}

/**
 * The confirmation a pipe asks for: titled "Run pipe", at the strictest tier among its stages,
 * and marked dangerous, naming the stages, when any stage is a dangerous command.
 */
export function pipeConfirmationSubject(
  segments: readonly string[],
  commands: readonly StageCommand[] | undefined,
): ConfirmationSubject {
  const pipe = segments.join(" | ");
  const ids = segments.map(pipeStageCommandId);
  const dangerous = ids
    .map((id) => commands?.find((c) => c.id === id))
    .filter((c): c is StageCommand => Boolean(c?.dangerous))
    .map((c) => c.title);
  return {
    commandId: pipe,
    title: "Run pipe",
    args: { pipe },
    dangerous: dangerous.length > 0,
    ...(dangerous.length === 1 && {
      description: `Includes a dangerous command: ${dangerous[0]}.`,
    }),
    ...(dangerous.length > 1 && {
      description: `Includes dangerous commands: ${dangerous.join(", ")}.`,
    }),
    ...strictestSensitivity(ids, commands),
  };
}

/** The message for pipe stage `stageNumber` (1-based) naming a command that runs only in the app. */
export function appOnlyStageMessage(stageNumber: number, title: string): string {
  return `Pipe stage ${stageNumber}: ${title} runs only in this app, so it cannot be part of a pipe.`;
}

/** The message for the first stage of `segments` that names a known command the server cannot run, or `null`. */
export function appOnlyStageError(
  segments: readonly string[],
  known: readonly StageCommand[],
): string | null {
  for (const [index, segment] of segments.entries()) {
    const id = pipeStageCommandId(segment);
    const command = known.find((c) => c.id === id);
    if (command && !runsOnServer(command)) return appOnlyStageMessage(index + 1, command.title);
  }
  return null;
}

const DESKTOP_LOCAL_STAGE = /stage (\d+) \('([^']+)'\) is desktop-local/;

/**
 * `message` with the server's refusal of a desktop-local stage
 * (`stage N ('id') is desktop-local`) replaced by `appOnlyStageMessage`; any other message unchanged.
 */
export function readablePipeError(message: string, known: readonly StageCommand[]): string {
  const match = DESKTOP_LOCAL_STAGE.exec(message);
  if (!match) return message;
  const [, stageNumber, id] = match;
  const title = known.find((c) => c.id === id)?.title ?? id;
  return appOnlyStageMessage(Number(stageNumber), title);
}
