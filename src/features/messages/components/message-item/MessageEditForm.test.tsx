import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MessageEditForm } from "./MessageEditForm";

describe("MessageEditForm", () => {
  it("hands focus back to the list that holds the message when the edit ends", () => {
    const { container, rerender } = render(
      <div data-message-list="" tabIndex={0}>
        <div data-message-id="m1">
          <MessageEditForm messageId="m1" initialText="hello" />
        </div>
      </div>,
    );
    const list = container.querySelector<HTMLElement>("[data-message-list]")!;
    const textarea = container.querySelector("textarea")!;
    textarea.focus();

    rerender(
      <div data-message-list="" tabIndex={0}>
        <div data-message-id="m1" />
      </div>,
    );
    expect(list).toHaveFocus();
  });

  it("leaves focus alone that moved elsewhere", () => {
    const { container, rerender } = render(
      <div>
        <button type="button">elsewhere</button>
        <div data-message-id="m1">
          <MessageEditForm messageId="m1" initialText="hello" />
        </div>
      </div>,
    );
    const other = container.querySelector("button")!;
    other.focus();
    rerender(
      <div>
        <button type="button">elsewhere</button>
        <div data-message-id="m1" />
      </div>,
    );
    expect(other).toHaveFocus();
  });
});
