import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { archiveConfirmation } from "../conversationActionTexts";
import { useConversationActionConfirmStore } from "../state/useConversationActionConfirmStore";
import { ConversationActionConfirmHost } from "./ConversationActionConfirmHost";

describe("ConversationActionConfirmHost", () => {
  afterEach(() => {
    act(() => useConversationActionConfirmStore.getState().cancel());
  });

  it("shows the pending confirmation and answers yes on its button", async () => {
    render(<ConversationActionConfirmHost />);
    let answer!: Promise<boolean>;
    act(() => {
      answer = useConversationActionConfirmStore.getState().ask(archiveConfirmation("#random"));
    });

    expect(screen.getByText("Archive #random?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await expect(answer).resolves.toBe(true);
    expect(screen.queryByText("Archive #random?")).not.toBeInTheDocument();
  });

  it("answers no on Cancel", async () => {
    render(<ConversationActionConfirmHost />);
    let answer!: Promise<boolean>;
    act(() => {
      answer = useConversationActionConfirmStore.getState().ask(archiveConfirmation("#random"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(answer).resolves.toBe(false);
    expect(screen.queryByText("Archive #random?")).not.toBeInTheDocument();
  });
});
