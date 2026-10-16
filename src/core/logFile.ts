import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";

/** The longest line the log file keeps of one console call. */
const MAX_LINE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Runs of 32 or more token characters: session and CSRF tokens, keys, base64 payloads. */
const TOKEN_LIKE = /[A-Za-z0-9+/_=-]{32,}/g;
/** A URL's query and fragment, which may carry tokens. */
const URL_QUERY = /\b((?:https?|wss?):\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g;
/** Where a JSON payload starts, such as the request a GraphQL client error quotes. */
const JSON_START = /[{[]\s*["{[]/;

/** A console argument as the log file keeps it: errors by name and message, objects by kind. */
function describe(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "string") return arg;
  if (arg === null || arg === undefined || typeof arg !== "object") return String(arg);
  return `[${arg.constructor?.name ?? "object"}]`;
}

/**
 * One console call as a log line. Plugin output is withheld, and JSON payloads, URL queries and
 * token-like strings are cut, so the file holds no message text, keys or tokens.
 */
export function logLine(args: unknown[]): string {
  let line = args.map(describe).join(" ");
  const plugin = /^\[plugin:([^\]]+)\]/.exec(line);
  if (plugin) return `[plugin:${plugin[1]}] output withheld`;
  const json = JSON_START.exec(line);
  if (json) line = `${line.slice(0, json.index)}{…}`;
  line = line
    .replace(URL_QUERY, "$1?…")
    .replace(TOKEN_LIKE, (run) => (UUID.test(run) ? run : "[redacted]"));
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
}

/**
 * Copies the webview's console warnings and errors, and uncaught errors, into the desktop
 * app's log file as {@link logLine} shapes them; returns a function that stops it.
 */
export function forwardConsoleToLogFile(): () => void {
  const original = { warn: console.warn, error: console.error };
  let writing = false;
  const write = (send: (line: string) => Promise<void>, args: unknown[]) => {
    if (writing) return;
    writing = true;
    try {
      send(logLine(args)).catch(() => undefined);
    } catch {
      // The log file is best effort; the console still has the entry.
    } finally {
      writing = false;
    }
  };

  console.warn = (...args: unknown[]) => {
    original.warn.apply(console, args);
    write(logWarn, args);
  };
  console.error = (...args: unknown[]) => {
    original.error.apply(console, args);
    write(logError, args);
  };
  const onError = (event: ErrorEvent) =>
    write(logError, ["Uncaught", event.error ?? event.message]);
  const onRejection = (event: PromiseRejectionEvent) =>
    write(logError, ["Unhandled rejection", event.reason]);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    console.warn = original.warn;
    console.error = original.error;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
