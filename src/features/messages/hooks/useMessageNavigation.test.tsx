import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders as render } from "../../../test/utils";
import { callsTo } from "../../conversations/__fixtures__/conversations";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useMessageFoldStore } from "../state/useMessageFoldStore";
import { useMessageNavigation } from "./useMessageNavigation";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

function Harness({ onCopy }: { onCopy: () => void }) {
  const { handleMessageListKeyDown } = useMessageNavigation({
    items: [{ id: "m-1", text: "hi", authorId: "u-2" }],
    conversationId: "c-1",
    workspaceId: "w-1",
    currentUserId: "u-1",
    editingMessageId: null,
    setEditingMessageId: vi.fn(),
    openThread: vi.fn(),
    onDeleteMessage: vi.fn(),
    onForwardMessage: vi.fn(),
    scrollToIndex: vi.fn(),
    pointerEntryRef: { current: null },
  });
  return (
    <>
      <div role="listbox" aria-label="Messages" tabIndex={0} onKeyDown={handleMessageListKeyDown}>
        <div role="option" aria-selected={false}>
          <button type="button" onClick={onCopy}>
            Copy code
          </button>
        </div>
      </div>
      <textarea data-composer-input aria-label="Composer" />
    </>
  );
}

/** An own message as the `NewMessage` event stores it: `authorId` set, no `author` object. */
const ownEventMessage = { id: "m-1", text: "hi", authorId: "u-1", author: null };

function OwnMessageHarness({
  setEditingMessageId,
  onDeleteMessage,
}: {
  setEditingMessageId: (id: string | null) => void;
  onDeleteMessage: (msg: { id: string }) => void;
}) {
  const { handleMessageListKeyDown } = useMessageNavigation({
    items: [ownEventMessage],
    conversationId: "c-1",
    workspaceId: "w-1",
    currentUserId: "u-1",
    editingMessageId: null,
    setEditingMessageId,
    openThread: vi.fn(),
    onDeleteMessage,
    onForwardMessage: vi.fn(),
    scrollToIndex: vi.fn(),
    pointerEntryRef: { current: null },
  });
  return (
    <div role="listbox" aria-label="Messages" tabIndex={0} onKeyDown={handleMessageListKeyDown} />
  );
}

afterEach(() => {
  useShellStore.getState().setNavigationMode(false);
});

describe("useMessageNavigation keys on row controls", () => {
  it("lets Enter and Space activate a focused control inside a row", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<Harness onCopy={onCopy} />);
    useShellStore.getState().setNavigationMode(true);

    const button = screen.getByRole("button", { name: "Copy code" });
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onCopy).toHaveBeenCalledTimes(2);
    expect(button).toHaveFocus();
    expect(useShellStore.getState().navigationMode).toBe(true);
  });

  it("still moves to the composer on Enter from the list itself", async () => {
    const user = userEvent.setup();
    render(<Harness onCopy={vi.fn()} />);
    useShellStore.getState().setNavigationMode(true);

    screen.getByRole("listbox").focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveFocus();
    expect(useShellStore.getState().navigationMode).toBe(false);
  });
});

describe("useMessageNavigation on an own message without an author object", () => {
  it("edits it with e", async () => {
    const user = userEvent.setup();
    const setEditingMessageId = vi.fn();
    render(
      <OwnMessageHarness setEditingMessageId={setEditingMessageId} onDeleteMessage={vi.fn()} />,
    );
    screen.getByRole("listbox").focus();
    act(() => useShellStore.getState().setNavigationMode(true));

    await user.keyboard("e");

    expect(setEditingMessageId).toHaveBeenCalledWith("m-1");
  });

  it("deletes it with d d", async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn();
    render(<OwnMessageHarness setEditingMessageId={vi.fn()} onDeleteMessage={onDeleteMessage} />);
    screen.getByRole("listbox").focus();
    act(() => useShellStore.getState().setNavigationMode(true));

    await user.keyboard("dd");

    expect(onDeleteMessage).toHaveBeenCalledWith(ownEventMessage);
  });
});

function KeysHarness({
  onReply,
  openThread,
  canStartThread,
  canPin,
  rootThreadId = null,
}: {
  onReply?: (messageId: string) => void;
  openThread: (messageId: string) => void;
  canStartThread?: boolean;
  canPin?: boolean;
  rootThreadId?: string | null;
}) {
  const { handleMessageListKeyDown } = useMessageNavigation({
    items: [{ id: "m-1", text: "hi", authorId: "u-2", rootThreadId }],
    conversationId: "c-1",
    workspaceId: "w-1",
    currentUserId: "u-1",
    editingMessageId: null,
    setEditingMessageId: vi.fn(),
    openThread,
    onDeleteMessage: vi.fn(),
    onForwardMessage: vi.fn(),
    onReply,
    canStartThread,
    canPin,
    scrollToIndex: vi.fn(),
    pointerEntryRef: { current: null },
  });
  return (
    <div role="listbox" aria-label="Messages" tabIndex={0} onKeyDown={handleMessageListKeyDown} />
  );
}

/** Focuses the list and enters NAVIGATE, which selects the only message. */
function enterNavigate() {
  screen.getByRole("listbox").focus();
  act(() => useShellStore.getState().setNavigationMode(true));
}

describe("useMessageNavigation reply and thread keys", () => {
  it("r starts a reply to the selected message", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    const openThread = vi.fn();
    render(<KeysHarness onReply={onReply} openThread={openThread} />);
    enterNavigate();

    await user.keyboard("r");

    expect(onReply).toHaveBeenCalledWith("m-1");
    expect(openThread).not.toHaveBeenCalled();
  });

  it("t opens the selected message's thread", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    const openThread = vi.fn();
    render(<KeysHarness onReply={onReply} openThread={openThread} />);
    enterNavigate();

    await user.keyboard("t");

    expect(openThread).toHaveBeenCalledWith("m-1");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("r does nothing without onReply", async () => {
    const user = userEvent.setup();
    const openThread = vi.fn();
    render(<KeysHarness openThread={openThread} />);
    enterNavigate();

    await user.keyboard("r");

    expect(openThread).not.toHaveBeenCalled();
  });

  it("t does nothing where threads cannot start and the message has none", async () => {
    const user = userEvent.setup();
    const openThread = vi.fn();
    const { unmount } = render(<KeysHarness openThread={openThread} canStartThread={false} />);
    enterNavigate();
    await user.keyboard("t");
    expect(openThread).not.toHaveBeenCalled();
    unmount();
    act(() => useShellStore.getState().setNavigationMode(false));

    render(<KeysHarness openThread={openThread} canStartThread={false} rootThreadId="th-1" />);
    enterNavigate();
    await user.keyboard("t");
    expect(openThread).toHaveBeenCalledWith("m-1");
  });

  it("p does not pin where pinning is not allowed", async () => {
    const user = userEvent.setup();
    requestMock.mockReset();
    render(<KeysHarness openThread={vi.fn()} canPin={false} />);
    enterNavigate();

    await user.keyboard("p");

    expect(callsTo(requestMock, "mutation PinMessage")).toEqual([]);
  });
});

function FoldHarness({
  onFoldToggle,
}: {
  onFoldToggle: (messageId: string, expanding: boolean) => void;
}) {
  const { handleMessageListKeyDown } = useMessageNavigation({
    items: [{ id: "m-1", text: "hi", authorId: "u-2" }],
    conversationId: "c-1",
    workspaceId: "w-1",
    currentUserId: "u-1",
    editingMessageId: null,
    setEditingMessageId: vi.fn(),
    openThread: vi.fn(),
    onDeleteMessage: vi.fn(),
    onForwardMessage: vi.fn(),
    onFoldToggle,
    scrollToIndex: vi.fn(),
    pointerEntryRef: { current: null },
  });
  return (
    <div role="listbox" aria-label="Messages" tabIndex={0} onKeyDown={handleMessageListKeyDown} />
  );
}

describe("useMessageNavigation fold key", () => {
  afterEach(() => {
    useMessageFoldStore.setState({ foldable: new Set(), expanded: new Set() });
  });

  it("o toggles the fold of a foldable selected message", async () => {
    const user = userEvent.setup();
    const onFoldToggle = vi.fn();
    useMessageFoldStore.getState().setFoldable("m-1", true);
    render(<FoldHarness onFoldToggle={onFoldToggle} />);
    enterNavigate();

    await user.keyboard("o");
    expect(onFoldToggle).toHaveBeenLastCalledWith("m-1", true);
    expect(useMessageFoldStore.getState().expanded.has("m-1")).toBe(true);

    await user.keyboard("o");
    expect(onFoldToggle).toHaveBeenLastCalledWith("m-1", false);
    expect(useMessageFoldStore.getState().expanded.has("m-1")).toBe(false);
  });

  it("o does nothing on a message that does not fold", async () => {
    const user = userEvent.setup();
    const onFoldToggle = vi.fn();
    render(<FoldHarness onFoldToggle={onFoldToggle} />);
    enterNavigate();

    await user.keyboard("o");

    expect(onFoldToggle).not.toHaveBeenCalled();
    expect(useMessageFoldStore.getState().expanded.has("m-1")).toBe(false);
  });
});
