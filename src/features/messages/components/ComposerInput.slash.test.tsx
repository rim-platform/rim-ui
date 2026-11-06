import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { serverInfoQueryClient } from "../../../test/serverInfo";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  baseReadHandlers,
  graphqlError,
  makeConversation,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../hooks/useTypingIndicator", () => ({
  useTypingIndicator: () => ({ handleKeystroke: () => {}, markSent: () => {} }),
}));

import { Composer } from "./Composer";
import { toast } from "../../../shared/toast";

const commands = Array.from({ length: 10 }, (_, i) => ({
  id: `chat.cmd_${i}`,
  title: `Command ${i}`,
  description: `Does thing ${i}`,
  category: "chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: true,
  visibleInContextMenus: false,
  keybindCapable: false,
  dangerous: false,
}));

async function openSlashList() {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Conversation(": () => ({ conversation: makeConversation() }),
    "query Commands": () => ({ commands }),
  });
  render(
    <QueryClientProvider client={serverInfoQueryClient()}>
      <Composer workspaceId="ws-1" conversationId="conv-1" />
    </QueryClientProvider>,
  );
  const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
  // The list is built from the commands loaded when the text changes.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  fireEvent.change(box, { target: { value: "", selectionStart: 0 } });
  fireEvent.change(box, { target: { value: "/", selectionStart: 1 } });
  await screen.findAllByRole("option");
  return box;
}

describe("ComposerInput — / suggestions", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("scrolls the selected slash suggestion into view", async () => {
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    const box = await openSlashList();

    for (let i = 0; i < 5; i++) fireEvent.keyDown(box, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    const selected = options.filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(options.indexOf(selected[0])).toBe(5);
    const last = spy.mock.calls.length - 1;
    expect(spy.mock.contexts[last]).toBe(selected[0]);
    expect(spy.mock.calls[last][0]).toEqual({ block: "nearest" });
  });

  it("left-aligns the suggestion rows", async () => {
    await openSlashList();
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) expect(option).toHaveClass("text-left");
  });

  it("says a refused slash command was not done", async () => {
    const spy = vi.spyOn(toast, "error");
    await openSlashList();
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "query Conversation(": () => ({ conversation: makeConversation() }),
      "query Commands": () => ({ commands }),
      "mutation ExecuteCommand": () => {
        throw graphqlError("FORBIDDEN", "Only moderators can do this");
      },
    });

    fireEvent.click(screen.getByRole("option", { name: /Command 0/ }));

    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith("Command 0: not done", {
        card: "denied",
        description: "Only moderators can do this",
      }),
    );
  });
});
