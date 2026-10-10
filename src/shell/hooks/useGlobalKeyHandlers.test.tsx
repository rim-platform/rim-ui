import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { useKeybindProfileStore } from "../../features/commands/state/useKeybindProfileStore";
import { useShellStore } from "../state/useShellStore";
import { useGlobalKeyHandlers } from "./useGlobalKeyHandlers";

function Harness() {
  useGlobalKeyHandlers();
  return <textarea data-composer-input aria-label="composer" />;
}

function typeOutsideAField(key: string) {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("useGlobalKeyHandlers", () => {
  afterEach(() => {
    useKeybindProfileStore.getState().setVimMode(false);
    useShellStore.getState().reset();
  });

  it("sends a printable key typed outside a field to the composer", () => {
    const { getByRole } = render(<Harness />);
    typeOutsideAField("x");
    expect(getByRole("textbox")).toHaveFocus();
  });

  it("leaves keys alone in Vim mode, where they are normal-mode commands", () => {
    useKeybindProfileStore.getState().setVimMode(true);
    const { getByRole } = render(<Harness />);
    typeOutsideAField("x");
    expect(getByRole("textbox")).not.toHaveFocus();
  });
});
