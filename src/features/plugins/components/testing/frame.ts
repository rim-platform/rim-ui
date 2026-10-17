// Driving a plugin panel's frame in jsdom: the files a panel is made of, what
// the host posts into the frame, and the messages the frame shell posts back.
import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";

import type { BundleFile } from "../../web/bundle";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A panel file holding `text`. */
export function textFile(path: string, text: string): BundleFile {
  return { path, bytes: encoder.encode(text) };
}

/** Let the panel's files arrive and the frame mount; the frame, or null. */
export async function mountedFrame(container: HTMLElement): Promise<HTMLIFrameElement | null> {
  await act(async () => {});
  return container.querySelector("iframe");
}

/** Spy on what the host posts into `iframe`'s window. */
export function spyOnFrame(iframe: HTMLIFrameElement): Mock {
  const frameWindow = iframe.contentWindow;
  if (!frameWindow) throw new Error("the frame has no window");
  return vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {}) as unknown as Mock;
}

/** Fire the frame's `load` event, as the browser does once the shell page loaded. */
export function loadFrame(iframe: HTMLIFrameElement): void {
  act(() => {
    iframe.dispatchEvent(new Event("load"));
  });
}

/** Post `data` from `iframe`'s window to the host, as a sandboxed frame does. */
export function fromFrame(iframe: HTMLIFrameElement, data: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data, origin: "null", source: iframe.contentWindow }),
    );
  });
}

/** What the real shell does on start: say hello to its parent, then the frame loads. */
export function startShell(iframe: HTMLIFrameElement): void {
  fromFrame(iframe, { type: "rim.frame.hello", v: 1 });
  loadFrame(iframe);
}

/** One file of a posted `rim.frame.init`, its bytes as text. */
export interface SentFile {
  path: string;
  type: string;
  text: string;
}

/** The `rim.frame.init` messages posted through `spy`, with each file's bytes as text. */
export function sentInits(spy: Mock): (Record<string, unknown> & { files: SentFile[] })[] {
  return spy.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter((message) => message.type === "rim.frame.init")
    .map((message) => ({
      ...message,
      files: (message.files as { path: string; type: string; bytes: ArrayBuffer }[]).map((f) => ({
        path: f.path,
        type: f.type,
        text: decoder.decode(f.bytes),
      })),
    }));
}

/** The messages posted through `spy` other than `rim.frame.init`. */
export function sentMessages(spy: Mock): unknown[] {
  return spy.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter((message) => message.type !== "rim.frame.init");
}
