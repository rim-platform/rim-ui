import { describe, it, expect } from "vitest";
import { parseKeystroke, matchKeybind, surfaceToContext } from "./keybindEngine";
import type { ResolvedKeybind } from "../types";

describe("parseKeystroke", () => {
  it("parses a simple key", () => {
    const event = new KeyboardEvent("keydown", { key: "a" });
    expect(parseKeystroke(event)).toBe("A");
  });

  it("parses Ctrl+key", () => {
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
    expect(parseKeystroke(event)).toBe("Ctrl+K");
  });

  it("parses Ctrl+Shift+key", () => {
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true });
    expect(parseKeystroke(event)).toBe("Ctrl+Shift+P");
  });

  it("parses Alt+key", () => {
    const event = new KeyboardEvent("keydown", { key: "n", altKey: true });
    expect(parseKeystroke(event)).toBe("Alt+N");
  });

  it("normalizes space key", () => {
    const event = new KeyboardEvent("keydown", { key: " " });
    expect(parseKeystroke(event)).toBe("Space");
  });

  it("returns empty for bare modifier keys", () => {
    expect(parseKeystroke(new KeyboardEvent("keydown", { key: "Control" }))).toBe("");
    expect(parseKeystroke(new KeyboardEvent("keydown", { key: "Shift" }))).toBe("");
    expect(parseKeystroke(new KeyboardEvent("keydown", { key: "Alt" }))).toBe("");
    expect(parseKeystroke(new KeyboardEvent("keydown", { key: "Meta" }))).toBe("");
  });

  it("handles special keys like Escape", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    expect(parseKeystroke(event)).toBe("Escape");
  });

  it("handles Meta key as Ctrl", () => {
    const event = new KeyboardEvent("keydown", { key: "c", metaKey: true });
    expect(parseKeystroke(event)).toBe("Ctrl+C");
  });
});

describe("matchKeybind", () => {
  const keybinds: ResolvedKeybind[] = [
    {
      id: "kb-1",
      keystroke: "Ctrl+K",
      commandId: "cmd-search",
      context: "GLOBAL",
      source: "DEFAULT",
      scope: "USER",
      isEnabled: true,
      presetArgs: null,
    },
    {
      id: "kb-2",
      keystroke: "Ctrl+Shift+P",
      commandId: "cmd-palette",
      context: "GLOBAL",
      source: "DEFAULT",
      scope: "USER",
      isEnabled: true,
      presetArgs: null,
    },
    {
      id: "kb-3",
      keystroke: "Ctrl+E",
      commandId: "cmd-edit",
      context: "COMPOSER",
      source: "DEFAULT",
      scope: "USER",
      isEnabled: true,
      presetArgs: null,
    },
    {
      id: "kb-4",
      keystroke: "Ctrl+D",
      commandId: "cmd-disabled",
      context: "GLOBAL",
      source: "DEFAULT",
      scope: "USER",
      isEnabled: false,
      presetArgs: null,
    },
  ];

  it("finds a global keybind", () => {
    const result = matchKeybind("Ctrl+K", "MESSAGE_LIST", keybinds);
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe("cmd-search");
  });

  it("finds a context-specific keybind", () => {
    const result = matchKeybind("Ctrl+E", "COMPOSER", keybinds);
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe("cmd-edit");
  });

  it("does not match context-specific keybind in wrong context", () => {
    const result = matchKeybind("Ctrl+E", "MESSAGE_LIST", keybinds);
    expect(result).toBeNull();
  });

  it("does not match disabled keybinds", () => {
    const result = matchKeybind("Ctrl+D", "GLOBAL", keybinds);
    expect(result).toBeNull();
  });

  it("returns null for empty keystroke", () => {
    expect(matchKeybind("", "GLOBAL", keybinds)).toBeNull();
  });

  it("returns null for unknown keystroke", () => {
    expect(matchKeybind("Ctrl+Z", "GLOBAL", keybinds)).toBeNull();
  });
});

describe("surfaceToContext", () => {
  it("maps composer surface", () => {
    expect(surfaceToContext("composer")).toBe("COMPOSER");
  });

  it("maps messageList surface", () => {
    expect(surfaceToContext("messageList")).toBe("MESSAGE_LIST");
  });

  it("maps threadView surface", () => {
    expect(surfaceToContext("threadView")).toBe("THREAD_VIEW");
  });

  it("maps conversationView surface", () => {
    expect(surfaceToContext("conversationView")).toBe("CONVERSATION_VIEW");
  });

  it("maps panel surface", () => {
    expect(surfaceToContext("panel")).toBe("PANEL");
  });

  it("maps commandPalette surface", () => {
    expect(surfaceToContext("commandPalette")).toBe("COMMAND_PALETTE");
  });

  it("maps null to Global", () => {
    expect(surfaceToContext(null)).toBe("GLOBAL");
  });

  it("maps unknown surface to Global", () => {
    expect(surfaceToContext("somethingElse")).toBe("GLOBAL");
  });
});
