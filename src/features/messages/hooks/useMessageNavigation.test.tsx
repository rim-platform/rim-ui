import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders as render } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useMessageNavigation } from "./useMessageNavigation";

function Harness({ onCopy }: { onCopy: () => void }) {
  const { handleMessageListKeyDown } = useMessageNavigation({
    items: [{ id: "m-1", text: "hi" }],
    conversationId: "c-1",
    workspaceId: "w-1",
    currentUserId: "u-1",
    editingMessageId: null,
    setEditingMessageId: vi.fn(),
    openThread: vi.fn(),
    onDeleteMessage: vi.fn(),
    onForwardMessage: vi.fn(),
    scrollToIndex: vi.fn(),
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
