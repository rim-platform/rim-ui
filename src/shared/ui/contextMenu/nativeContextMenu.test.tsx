import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import type { AppPlatform } from "../../../core/runtime/runtime";
import { useNativeContextMenuPolicy } from "./nativeContextMenu";

function Policy({ platform }: { platform: AppPlatform }) {
  useNativeContextMenuPolicy(platform);
  return (
    <div>
      <p data-testid="text">A message</p>
      <input data-testid="input" />
      <textarea data-testid="textarea" />
      <div data-testid="composer" contentEditable suppressContentEditableWarning>
        <span data-testid="composer-child">draft</span>
      </div>
      <div data-testid="read-only" contentEditable={false}>
        fixed
      </div>
      <button
        type="button"
        data-testid="own-menu"
        onContextMenu={(event) => event.preventDefault()}
      >
        row
      </button>
    </div>
  );
}

/** Right-clicks the element and returns whether the webview's own menu would show. */
function nativeMenuShows(element: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return !event.defaultPrevented;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

describe("useNativeContextMenuPolicy", () => {
  it("hides the webview's menu on the desktop where the app shows none", () => {
    const { getByTestId } = render(<Policy platform="desktop" />);
    expect(nativeMenuShows(getByTestId("text"))).toBe(false);
    expect(nativeMenuShows(getByTestId("read-only"))).toBe(false);
    expect(nativeMenuShows(document.body)).toBe(false);
  });

  it("keeps it in text fields and editable content", () => {
    const { getByTestId } = render(<Policy platform="desktop" />);
    expect(nativeMenuShows(getByTestId("input"))).toBe(true);
    expect(nativeMenuShows(getByTestId("textarea"))).toBe(true);
    expect(nativeMenuShows(getByTestId("composer"))).toBe(true);
    expect(nativeMenuShows(getByTestId("composer-child"))).toBe(true);
  });

  it("keeps it while text is selected, not for a collapsed caret", () => {
    const { getByTestId } = render(<Policy platform="desktop" />);
    const text = getByTestId("text");
    const selection = window.getSelection()!;

    const caret = document.createRange();
    caret.setStart(text.firstChild!, 2);
    selection.addRange(caret);
    expect(nativeMenuShows(text)).toBe(false);

    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.addRange(range);
    expect(nativeMenuShows(text)).toBe(true);
  });

  it("leaves an event the app already handled as it is", () => {
    const { getByTestId } = render(<Policy platform="desktop" />);
    expect(nativeMenuShows(getByTestId("own-menu"))).toBe(false);
  });

  it("leaves the browser's menu alone on the web", () => {
    const { getByTestId } = render(<Policy platform="web" />);
    expect(nativeMenuShows(getByTestId("text"))).toBe(true);
    expect(nativeMenuShows(document.body)).toBe(true);
  });

  it("stops hiding the menu once unmounted", () => {
    const { getByTestId, unmount } = render(<Policy platform="desktop" />);
    const text = getByTestId("text");
    unmount();
    document.body.appendChild(text);
    expect(nativeMenuShows(text)).toBe(true);
    text.remove();
  });
});
