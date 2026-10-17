// The panel frame both plugin kinds use: the frame shell in a sandboxed frame,
// the panel's files in `rim.frame.init` once the shell says hello, the loading states
// until the shell reports the panel rendered, and failures with Retry.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { DESKTOP_SHELL_URL, FRAME_ALLOW, FRAME_SANDBOX } from "../web/webPluginHost";
import { PluginFrame, type PluginFrameProps } from "./PluginFrame";
import {
  fromFrame,
  loadFrame,
  mountedFrame,
  sentInits,
  sentMessages,
  spyOnFrame,
  startShell,
  textFile,
} from "./testing/frame";

const FILES = [
  textFile("index.html", '<script src="app.js"></script>'),
  textFile("app.js", "go()"),
];

function setup(overrides: Partial<PluginFrameProps> = {}) {
  const follower = { load: vi.fn(() => Promise.resolve()), stop: vi.fn() };
  const props: PluginFrameProps = {
    shellSrc: DESKTOP_SHELL_URL,
    pluginId: "dev.example.panel",
    panelId: "main",
    pluginName: "Example",
    approvedCapabilities: [],
    loadFiles: vi.fn(() => Promise.resolve(FILES)),
    origins: ["https://api.example.com"],
    followState: vi.fn(() => follower),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<PluginFrame {...props} />);
  return { ...view, props, follower };
}

/** A mounted panel and its frame, with the host's posts into it spied. */
async function mountedPanel(overrides: Partial<PluginFrameProps> = {}) {
  const panel = setup(overrides);
  const iframe = await mountedFrame(panel.container);
  if (!iframe) throw new Error("no frame");
  return { ...panel, iframe, posted: spyOnFrame(iframe) };
}

/** A mounted panel whose shell started. */
async function loadedPanel(overrides: Partial<PluginFrameProps> = {}) {
  const panel = await mountedPanel(overrides);
  startShell(panel.iframe);
  return panel;
}

const HELLO = { type: "rim.frame.hello", v: 1 };

afterEach(() => {
  vi.useRealTimers();
  useShellStore.setState({ selectedConversationId: null });
});

describe("PluginFrame", () => {
  it("loads the frame shell in a frame sandboxed to scripts alone", async () => {
    const { container } = setup();
    const iframe = await mountedFrame(container);
    expect(iframe?.getAttribute("src")).toBe(DESKTOP_SHELL_URL);
    expect(iframe?.getAttribute("sandbox")).toBe(FRAME_SANDBOX);
    expect(iframe?.getAttribute("allow")).toBe(FRAME_ALLOW);
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe?.hasAttribute("credentialless")).toBe(true);
    expect(iframe?.getAttribute("title")).toBe("Plugin: Example");
  });

  it("posts the panel's files and origins once, only to its own shell after that shell's hello", async () => {
    const { iframe, posted } = await mountedPanel();
    loadFrame(iframe);
    // Another window, or a hello that is not from an opaque origin, gets nothing.
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: HELLO, origin: "null" }));
      window.dispatchEvent(
        new MessageEvent("message", {
          data: HELLO,
          origin: "https://evil.example",
          source: iframe.contentWindow,
        }),
      );
    });
    expect(sentInits(posted)).toEqual([]);

    fromFrame(iframe, HELLO);
    // Panel code saying hello again gets no second copy.
    fromFrame(iframe, HELLO);
    expect(sentInits(posted)).toEqual([
      {
        type: "rim.frame.init",
        v: 1,
        kind: "panel",
        pluginId: "dev.example.panel",
        panelId: "main",
        policy: { origins: ["https://api.example.com"] },
        files: [
          { path: "index.html", type: "text/html", text: '<script src="app.js"></script>' },
          { path: "app.js", type: "text/javascript", text: "go()" },
        ],
      },
    ]);
    expect(posted.mock.calls[0][1]).toBe("*");
  });

  it("once the shell reports the panel rendered, sends the theme and stored state and stays loaded", async () => {
    vi.useFakeTimers();
    const { iframe, posted, follower, props } = await loadedPanel();
    expect(props.followState).toHaveBeenCalledTimes(1);

    // Only the frame's own window is listened to.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { type: "rim.frame.ready", v: 1 }, origin: "null" }),
      );
    });
    expect(follower.load).not.toHaveBeenCalled();

    fromFrame(iframe, { type: "rim.frame.ready", v: 1 });
    expect(sentMessages(posted)).toEqual([expect.objectContaining({ type: "theme.changed" })]);
    expect(follower.load).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(screen.queryByText("Plugin is taking longer than expected")).toBeNull();
    expect(screen.queryByText("Plugin timed out")).toBeNull();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("shows loading, slow and timed out while the shell never reports; Retry starts over", async () => {
    vi.useFakeTimers();
    const { iframe, follower, props } = await loadedPanel();

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(13_000));
    expect(screen.getByText("Plugin is taking longer than expected")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByText("Plugin timed out")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(follower.stop).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(props.loadFiles).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Plugin timed out")).toBeNull();
    const fresh = document.querySelector("iframe");
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(iframe);
  });

  it("closes the frame and offers Retry when the shell fails, the panel navigates, or its files cannot be read", async () => {
    const failed = await loadedPanel();
    fromFrame(failed.iframe, {
      type: "rim.frame.error",
      v: 1,
      message: "the panel has no index.html",
    });
    expect(screen.getByText("the panel has no index.html")).toBeInTheDocument();
    expect(failed.container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    failed.unmount();

    const navigated = await loadedPanel();
    loadFrame(navigated.iframe);
    // The page it navigated to may say hello; it gets no files.
    fromFrame(navigated.iframe, HELLO);
    expect(sentInits(navigated.posted)).toHaveLength(1);
    expect(
      screen.getByText("The panel navigated away from its page, so it was closed."),
    ).toBeInTheDocument();
    navigated.unmount();

    const unreadable = setup({
      loadFiles: vi.fn(() => Promise.reject(new Error("the panel has no folder"))),
    });
    expect(await mountedFrame(unreadable.container)).toBeNull();
    expect(screen.getByText("the panel has no folder")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(unreadable.props.onClose).toHaveBeenCalledTimes(1);
  });

  it("stops following the panel's state when it closes", async () => {
    const { follower, unmount } = await loadedPanel();
    unmount();
    expect(follower.stop).toHaveBeenCalledTimes(1);
  });

  it("tells a panel that may read chat which conversation is open, and every change after", async () => {
    useShellStore.setState({ selectedConversationId: "c1" });
    const { iframe, posted } = await loadedPanel({ approvedCapabilities: ["chat.read"] });
    // Nothing before the panel rendered.
    act(() => useShellStore.setState({ selectedConversationId: "c2" }));
    expect(sentMessages(posted)).toEqual([]);

    fromFrame(iframe, { type: "rim.frame.ready", v: 1 });
    act(() => useShellStore.setState({ selectedConversationId: "c3" }));
    act(() => useShellStore.setState({ isThreadOpen: true }));
    act(() => useShellStore.setState({ selectedConversationId: null }));
    const sent = sentMessages(posted) as { type: string }[];
    expect(sent.filter((m) => m.type === "conversation.changed")).toEqual([
      { type: "conversation.changed", conversationId: "c2" },
      { type: "conversation.changed", conversationId: "c3" },
      { type: "conversation.changed", conversationId: null },
    ]);
  });

  it("keeps the open conversation from a panel whose plugin may not read chat", async () => {
    useShellStore.setState({ selectedConversationId: "c1" });
    const { iframe, posted, unmount } = await loadedPanel({ approvedCapabilities: ["ui.panel"] });
    fromFrame(iframe, { type: "rim.frame.ready", v: 1 });
    act(() => useShellStore.setState({ selectedConversationId: "c2" }));
    expect((sentMessages(posted) as { type: string }[]).map((m) => m.type)).toEqual([
      "theme.changed",
    ]);

    unmount();
    act(() => useShellStore.setState({ selectedConversationId: "c3" }));
    expect((sentMessages(posted) as { type: string }[]).map((m) => m.type)).toEqual([
      "theme.changed",
    ]);
  });
});
