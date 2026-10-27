import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./commandDispatcher", () => ({
  runDesktopLocalCommand: vi.fn(() => true),
}));

vi.mock("../../../shell/navigation/spatialNavigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shell/navigation/spatialNavigation")>()),
  navigatePanel: vi.fn(),
}));

import { navigatePanel } from "../../../shell/navigation/spatialNavigation";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useCommandStore } from "../state/useCommandStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { useVimStore } from "../state/useVimStore";
import { runDesktopLocalCommand } from "./commandDispatcher";
import { installVimLayer } from "./vimLayer";

let uninstall: () => void = () => {};

function press(
  key: string,
  options: KeyboardEventInit = {},
  target: EventTarget = document.activeElement ?? document.body,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

/** Let focus-driven mode changes run. */
async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function mount(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  useKeybindProfileStore.getState().setVimMode(true);
  useCommandStore.setState({ isCommandPaletteOpen: false });
  useShellStore.getState().reset();
  useVimStore.setState({ mode: "normal", pending: "" });
  uninstall = installVimLayer();
});

afterEach(() => {
  vi.useRealTimers();
  uninstall();
  useKeybindProfileStore.getState().setVimMode(false);
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Vim layer modes", () => {
  it("does nothing while Vim mode is off", () => {
    useKeybindProfileStore.getState().setVimMode(false);
    mount('<div data-panel="mainSurface" tabindex="-1"></div>');
    expect(press(":").defaultPrevented).toBe(false);
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("is in insert mode while a text field has focus and in normal mode otherwise", async () => {
    mount(
      '<div data-panel="mainSurface" tabindex="-1"><textarea data-composer-input></textarea></div>',
    );
    const composer = document.querySelector("textarea")!;
    composer.focus();
    await settle();
    expect(useVimStore.getState().mode).toBe("insert");
    composer.blur();
    await settle();
    expect(useVimStore.getState().mode).toBe("normal");
  });

  it("leaves every key typed in insert mode to the field", () => {
    mount('<input type="text" />');
    const input = document.querySelector("input")!;
    input.focus();
    for (const key of ["j", "k", ":", "/", "i", "g", "G", "3", "h"]) {
      expect(press(key).defaultPrevented).toBe(false);
    }
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    expect(runDesktopLocalCommand).not.toHaveBeenCalled();
  });

  it("returns to normal mode on Escape: the field gives focus to its pane", async () => {
    mount('<div data-panel="toolPanel" tabindex="-1"><input type="search" /></div>');
    const input = document.querySelector("input")!;
    input.focus();
    press("Escape");
    expect(document.activeElement).toBe(document.querySelector('[data-panel="toolPanel"]'));
    await settle();
    expect(useVimStore.getState().mode).toBe("normal");
  });

  it("stays in insert mode when the field used Escape itself", () => {
    mount('<div data-panel="mainSurface" tabindex="-1"><input type="text" /></div>');
    const input = document.querySelector("input")!;
    input.addEventListener("keydown", (event) => event.preventDefault());
    input.focus();
    press("Escape");
    expect(document.activeElement).toBe(input);
  });

  it("treats Ctrl+[ as Escape", () => {
    mount('<div data-panel="mainSurface" tabindex="-1"><input type="text" /></div>');
    const input = document.querySelector("input")!;
    const seen: string[] = [];
    input.addEventListener("keydown", (event) => seen.push(event.key));
    input.focus();
    const event = press("[", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(seen).toEqual(["Escape"]);
    expect(document.activeElement).toBe(document.querySelector('[data-panel="mainSurface"]'));
  });

  it("leaves a plugin frame's keys alone and counts the frame as insert mode", async () => {
    mount('<iframe title="plugin"></iframe>');
    const frame = document.querySelector("iframe")!;
    frame.focus();
    await settle();
    expect(useVimStore.getState().mode).toBe("insert");
    expect(press(":", {}, frame).defaultPrevented).toBe(false);
    expect(press("[", { ctrlKey: true }, frame).defaultPrevented).toBe(false);
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });
});

describe("Vim normal mode", () => {
  it("opens the command palette on :", () => {
    mount('<div data-panel="mainSurface" tabindex="-1"></div>');
    expect(press(":").defaultPrevented).toBe(true);
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(true);
  });

  it("leaves keys in a keystroke recorder alone", () => {
    mount('<kbd role="button" tabindex="0" data-keystroke-recorder="">Ctrl+K</kbd>');
    const recorder = document.querySelector("kbd") as HTMLElement;
    recorder.focus();

    expect(press(":", {}, recorder).defaultPrevented).toBe(false);
    expect(press("j", {}, recorder).defaultPrevented).toBe(false);
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
  });

  it("leaves every key alone while the palette is open", () => {
    useCommandStore.setState({ isCommandPaletteOpen: true });
    expect(press("j").defaultPrevented).toBe(false);
  });

  it("runs search on / and unread navigation on n and p", () => {
    press("/");
    expect(runDesktopLocalCommand).toHaveBeenCalledWith("workspace.search_in_channel");
    press("n");
    expect(runDesktopLocalCommand).toHaveBeenCalledWith("workspace.next_unread_channel");
    press("p");
    expect(runDesktopLocalCommand).toHaveBeenCalledWith("workspace.previous_unread_channel");
  });

  it("leaves n, p, / and i to the message list, which has its own", () => {
    mount('<div data-message-list role="listbox" tabindex="0"></div>');
    const list = document.querySelector<HTMLElement>("[data-message-list]")!;
    list.focus();
    for (const key of ["n", "p", "/", "i"]) {
      expect(press(key).defaultPrevented).toBe(false);
    }
    expect(runDesktopLocalCommand).not.toHaveBeenCalled();
  });

  it("moves between panes on h and l", () => {
    press("h");
    expect(navigatePanel).toHaveBeenCalledWith("left");
    press("l");
    expect(navigatePanel).toHaveBeenCalledWith("right");
  });

  it("sends j, k, gg and G to the focused list as arrow keys, Home and End", () => {
    mount('<div data-panel="toolPanel"><div role="listbox" tabindex="0"></div></div>');
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const received: string[] = [];
    list.addEventListener("keydown", (event) => {
      received.push(event.key);
      event.preventDefault();
    });
    list.focus();
    expect(press("j").defaultPrevented).toBe(true);
    press("k");
    press("g");
    press("g");
    press("G", { shiftKey: true });
    expect(received).toEqual(["ArrowDown", "ArrowUp", "Home", "End"]);
  });

  it("moves focus through a pane's items when no list answers", () => {
    mount(`
      <div data-panel="sideRail" tabindex="-1">
        <button>One</button><button>Two</button><input type="text" /><button>Three</button>
      </div>`);
    const [one, two, three] = Array.from(document.querySelectorAll("button"));
    one.focus();
    press("j");
    expect(document.activeElement).toBe(two);
    // Text fields are skipped: moving never drops into insert mode.
    press("j");
    expect(document.activeElement).toBe(three);
    press("g");
    press("g");
    expect(document.activeElement).toBe(one);
    press("G", { shiftKey: true });
    expect(document.activeElement).toBe(three);
    press("k");
    expect(document.activeElement).toBe(two);
  });

  it("enters a pane's list first when the pane itself has focus", () => {
    mount(
      '<div data-panel="mainSurface" tabindex="-1"><button>Lens</button><div role="listbox" tabindex="0"></div></div>',
    );
    document.querySelector<HTMLElement>('[data-panel="mainSurface"]')!.focus();
    press("j");
    expect(document.activeElement).toBe(document.querySelector('[role="listbox"]'));
  });

  it("repeats a motion by a count prefix and shows the count while typed", () => {
    // Each repeat is its own timer task: draining the timers runs all of them, however slowly
    // real time passes, so the focus checked is where the last one left it.
    vi.useFakeTimers();
    mount(`
      <div data-panel="sideRail" tabindex="-1">
        <button>1</button><button>2</button><button>3</button><button>4</button><button>5</button>
      </div>`);
    const buttons = Array.from(document.querySelectorAll("button"));
    buttons[0].focus();
    expect(press("3").defaultPrevented).toBe(true);
    expect(useVimStore.getState().pending).toBe("3");
    press("j");
    expect(useVimStore.getState().pending).toBe("");
    expect(document.activeElement).toBe(buttons[1]);
    vi.runAllTimers();
    expect(document.activeElement).toBe(buttons[3]);
  });

  it("enters insert mode in the composer on i, and on Enter when nothing is focused", () => {
    mount(
      '<div data-panel="mainSurface" tabindex="-1"><button>Send</button><textarea data-composer-input></textarea></div>',
    );
    const composer = document.querySelector("textarea")!;
    press("i");
    expect(document.activeElement).toBe(composer);
    composer.blur();
    press("Enter");
    expect(document.activeElement).toBe(composer);
  });

  it("leaves Enter to a focused button", () => {
    mount("<button>Open</button><textarea data-composer-input></textarea>");
    const button = document.querySelector("button")!;
    button.focus();
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("inside a dialog only moves, leaving other keys to the dialog", () => {
    mount('<div role="dialog"><button>A</button><button>B</button></div>');
    const [a, b] = Array.from(document.querySelectorAll("button"));
    a.focus();
    expect(press(":").defaultPrevented).toBe(false);
    expect(useCommandStore.getState().isCommandPaletteOpen).toBe(false);
    press("j");
    expect(document.activeElement).toBe(b);
  });

  it("forgets a half-typed command on a key it does not know", () => {
    press("2");
    press("x");
    expect(useVimStore.getState().pending).toBe("");
  });
});
