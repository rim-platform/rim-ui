import { describe, expect, it } from "vitest";

import { BUILT_IN_PROFILES, BUILT_IN_PROFILE_IDS, DEFAULT_BINDINGS } from "./builtInProfiles";
import {
  PROFILE_FORMAT,
  canonicalKeystroke,
  mergeOverDefaults,
  parseKeybindProfile,
  profileFileName,
  profileKeybinds,
  sameBindings,
  serializeKeybindProfile,
  validateKeybindProfile,
  type KeybindProfile,
  type ProfileBinding,
} from "./keybindProfile";

function profileJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: PROFILE_FORMAT,
    version: 1,
    name: "Mine",
    description: "My keys",
    vimMode: false,
    bindings: [{ keystroke: "Ctrl+K", commandId: "workspace.open_command_palette" }],
    ...overrides,
  };
}

function errorsOf(value: unknown): string[] {
  const result = validateKeybindProfile(value);
  if (result.ok) throw new Error("expected the profile to be refused");
  return result.errors;
}

describe("built-in profiles", () => {
  it("are valid profiles that survive an export and an import unchanged", () => {
    for (const id of BUILT_IN_PROFILE_IDS) {
      const profile = BUILT_IN_PROFILES[id];
      expect(parseKeybindProfile(serializeKeybindProfile(profile))).toEqual({ ok: true, profile });
    }
  });

  it("only the vim profile turns Vim mode on", () => {
    expect(BUILT_IN_PROFILES.minimal.vimMode).toBe(false);
    expect(BUILT_IN_PROFILES.vim.vimMode).toBe(true);
    expect(BUILT_IN_PROFILES["mouse-friendly"].vimMode).toBe(false);
  });

  it("minimal binds the plain default set, every key once", () => {
    expect(BUILT_IN_PROFILES.minimal.bindings).toEqual(DEFAULT_BINDINGS);
    const slots = DEFAULT_BINDINGS.map((b) => `${b.context} ${b.keystroke}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("gives every default binding a modifier except Escape and ?", () => {
    const plain = DEFAULT_BINDINGS.filter((b) => !b.keystroke.includes("+")).map(
      (b) => b.keystroke,
    );
    expect(plain.sort()).toEqual(["?", "Escape"]);
  });

  it("mouse-friendly frees the keys browsers and editors use and keeps the rest", () => {
    const bindings = BUILT_IN_PROFILES["mouse-friendly"].bindings;
    const freed = bindings.filter((b) => b.commandId === null).map((b) => b.keystroke);
    expect(freed).toEqual(
      expect.arrayContaining([
        "Ctrl+R",
        "Ctrl+B",
        "Ctrl+D",
        "Ctrl+L",
        "Ctrl+Shift+Z",
        "Alt+ArrowLeft",
      ]),
    );
    expect(bindings.find((b) => b.keystroke === "Ctrl+K")?.commandId).toBe(
      "workspace.open_command_palette",
    );
  });

  it("offers the shortcuts panel on ? and Ctrl+/", () => {
    for (const keystroke of ["?", "Ctrl+/"]) {
      expect(DEFAULT_BINDINGS).toContainEqual({
        keystroke,
        commandId: "workspace.show_shortcuts",
        context: "GLOBAL",
      });
    }
  });
});

describe("validateKeybindProfile", () => {
  it("accepts a profile, filling in the context and putting keystrokes in canonical form", () => {
    const result = validateKeybindProfile(
      profileJson({
        bindings: [
          { keystroke: "Shift+Ctrl+K", commandId: "workspace.open_search" },
          { keystroke: "Meta+Shift+?", commandId: "workspace.show_shortcuts", context: "PANEL" },
          { keystroke: "Ctrl+R", commandId: null },
          { keystroke: "Esc", commandId: "workspace.close_panel" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      profile: {
        format: PROFILE_FORMAT,
        version: 1,
        name: "Mine",
        description: "My keys",
        vimMode: false,
        bindings: [
          { keystroke: "Ctrl+Shift+K", commandId: "workspace.open_search", context: "GLOBAL" },
          { keystroke: "Ctrl+?", commandId: "workspace.show_shortcuts", context: "PANEL" },
          { keystroke: "Ctrl+R", commandId: null, context: "GLOBAL" },
          { keystroke: "Escape", commandId: "workspace.close_panel", context: "GLOBAL" },
        ],
      },
    });
  });

  it("refuses something that is not a profile", () => {
    expect(errorsOf([])).toEqual(["The file is not a keybind profile: it is not a JSON object."]);
    expect(errorsOf(profileJson({ format: "something-else" }))[0]).toMatch(
      /"format" must be "rim.keybind-profile"/,
    );
  });

  it("says a newer profile version comes from a newer app", () => {
    expect(errorsOf(profileJson({ version: 2 }))).toEqual([
      "The profile is version 2, made by a newer RIM. This app reads version 1.",
    ]);
    expect(errorsOf(profileJson({ version: "1" }))).toEqual(['"version" must be 1.']);
  });

  it("lists every problem with where it is", () => {
    const errors = errorsOf(
      profileJson({
        name: " ",
        vimMode: "yes",
        bindings: [
          { keystroke: "Hyper+K", commandId: "workspace.open_settings" },
          { keystroke: "Ctrl+K", commandId: "not an id" },
          { keystroke: "Ctrl+K", commandId: "workspace.open_settings", context: "SOMEWHERE" },
          { keystroke: 7, commandId: "workspace.open_settings" },
          { keystroke: "Ctrl+", commandId: "workspace.open_settings" },
          "Ctrl+J",
          { keystroke: "Ctrl+J", commandId: "workspace.open_settings" },
          { keystroke: "Ctrl+j", commandId: "workspace.open_search" },
        ],
      }),
    );
    expect(errors).toEqual([
      '"name" must be a non-empty text.',
      '"vimMode" must be true or false.',
      'bindings[0].keystroke "Hyper" is not a modifier (use Ctrl, Shift, Alt or Meta).',
      'bindings[1].commandId must be a command id, such as "workspace.open_settings".',
      "bindings[2].context must be one of GLOBAL, COMPOSER, MESSAGE_LIST, THREAD_VIEW, CONVERSATION_VIEW, PANEL, COMMAND_PALETTE.",
      'bindings[3].keystroke must be text, such as "Ctrl+K".',
      'bindings[4].keystroke "Ctrl+" does not end with a key.',
      "bindings[5] must be an object.",
      "bindings[7] binds Ctrl+J again; bindings[6] already does.",
    ]);
  });

  it("refuses a missing binding list and oversized fields", () => {
    expect(errorsOf(profileJson({ bindings: undefined }))).toEqual(['"bindings" must be a list.']);
    expect(errorsOf(profileJson({ name: "x".repeat(81) }))).toEqual([
      '"name" is longer than 80 characters.',
    ]);
    expect(errorsOf(profileJson({ description: 3 }))).toEqual(['"description" must be text.']);
    const many = Array.from({ length: 501 }, (_, i) => ({
      keystroke: `Ctrl+F${i}`,
      commandId: "workspace.open_settings",
    }));
    expect(errorsOf(profileJson({ bindings: many }))).toEqual([
      '"bindings" has more than 500 entries.',
    ]);
  });
});

describe("parseKeybindProfile", () => {
  it("reports text that is not JSON", () => {
    const result = parseKeybindProfile("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^The file is not valid JSON: /);
  });
});

describe("canonicalKeystroke", () => {
  it("orders modifiers, maps Meta to Ctrl and names keys as the browser does", () => {
    expect(canonicalKeystroke("Alt+Shift+Ctrl+k")).toEqual({
      ok: true,
      value: "Ctrl+Shift+Alt+K",
    });
    expect(canonicalKeystroke("Cmd+Up")).toEqual({ ok: true, value: "Ctrl+ArrowUp" });
    expect(canonicalKeystroke("Ctrl++")).toEqual({ ok: true, value: "Ctrl++" });
    expect(canonicalKeystroke("")).toEqual({ ok: false, error: "is empty" });
  });

  it("accepts modifiers in any case and stores them canonically", () => {
    expect(canonicalKeystroke("ctrl+j")).toEqual({ ok: true, value: "Ctrl+J" });
    expect(canonicalKeystroke("SHIFT+alt+ArrowUp")).toEqual({
      ok: true,
      value: "Shift+Alt+ArrowUp",
    });
    expect(canonicalKeystroke("cmd+k")).toEqual({ ok: true, value: "Ctrl+K" });
  });
});

describe("profileKeybinds", () => {
  it("turns a freed keystroke into a disabled keybind with no command", () => {
    const [bound, freed] = profileKeybinds({
      ...BUILT_IN_PROFILES.minimal,
      bindings: [
        { keystroke: "Ctrl+K", commandId: "workspace.open_command_palette", context: "GLOBAL" },
        { keystroke: "Ctrl+R", commandId: null, context: "GLOBAL" },
      ],
    });
    expect(bound).toMatchObject({ commandId: "workspace.open_command_palette", isEnabled: true });
    expect(freed).toMatchObject({ keystroke: "Ctrl+R", commandId: "", isEnabled: false });
  });
});

describe("mergeOverDefaults", () => {
  const defaults: ProfileBinding[] = [
    { keystroke: "Ctrl+K", commandId: "workspace.open_command_palette", context: "GLOBAL" },
    { keystroke: "Ctrl+R", commandId: "workspace.cycle_recent_activity", context: "GLOBAL" },
    { keystroke: "?", commandId: "workspace.show_shortcuts", context: "GLOBAL" },
    { keystroke: "Ctrl+/", commandId: "workspace.show_shortcuts", context: "GLOBAL" },
  ];

  function imported(bindings: ProfileBinding[]): KeybindProfile {
    return {
      format: PROFILE_FORMAT,
      version: 1,
      name: "Team keys",
      description: "Shared keys",
      vimMode: true,
      bindings,
    };
  }

  it("keeps every default the profile does not name", () => {
    const merged = mergeOverDefaults(
      defaults,
      imported([{ keystroke: "Ctrl+J", commandId: "workspace.open_search", context: "GLOBAL" }]),
    );
    expect(merged.bindings.slice(0, defaults.length)).toEqual(defaults);
  });

  it("puts the profile's binding in place of the default on the same keys and context", () => {
    const merged = mergeOverDefaults(
      defaults,
      imported([{ keystroke: "Ctrl+K", commandId: "workspace.open_search", context: "GLOBAL" }]),
    );
    expect(merged.bindings).toEqual([
      { keystroke: "Ctrl+K", commandId: "workspace.open_search", context: "GLOBAL" },
      ...defaults.slice(1),
    ]);
  });

  it("adds bindings on keys no default holds after the defaults", () => {
    const merged = mergeOverDefaults(
      defaults,
      imported([
        { keystroke: "Ctrl+J", commandId: "workspace.open_search", context: "GLOBAL" },
        { keystroke: "Ctrl+Shift+J", commandId: "workspace.open_agent", context: "GLOBAL" },
      ]),
    );
    expect(merged.bindings).toEqual([
      ...defaults,
      { keystroke: "Ctrl+J", commandId: "workspace.open_search", context: "GLOBAL" },
      { keystroke: "Ctrl+Shift+J", commandId: "workspace.open_agent", context: "GLOBAL" },
    ]);
  });

  it("removes and frees a default the profile unbinds", () => {
    const merged = mergeOverDefaults(
      defaults,
      imported([{ keystroke: "Ctrl+R", commandId: null, context: "GLOBAL" }]),
    );
    expect(merged.bindings).toHaveLength(defaults.length);
    expect(merged.bindings[1]).toEqual({ keystroke: "Ctrl+R", commandId: null, context: "GLOBAL" });
    expect(profileKeybinds(merged).find((keybind) => keybind.keystroke === "Ctrl+R")).toMatchObject(
      { isEnabled: false, commandId: "" },
    );
  });

  it("keeps a default on another context of the same keystroke", () => {
    const merged = mergeOverDefaults(
      defaults,
      imported([{ keystroke: "Ctrl+K", commandId: "chat.send", context: "COMPOSER" }]),
    );
    expect(merged.bindings).toEqual([
      ...defaults,
      { keystroke: "Ctrl+K", commandId: "chat.send", context: "COMPOSER" },
    ]);
  });

  it("leaves another key of the same command bound", () => {
    const merged = mergeOverDefaults(
      defaults,
      imported([{ keystroke: "Ctrl+J", commandId: "workspace.show_shortcuts", context: "GLOBAL" }]),
    );
    const shortcutKeys = merged.bindings
      .filter((binding) => binding.commandId === "workspace.show_shortcuts")
      .map((binding) => binding.keystroke);
    expect(shortcutKeys).toEqual(["?", "Ctrl+/", "Ctrl+J"]);
  });

  it("keeps the profile's name, description and Vim mode", () => {
    const profile = imported([]);
    const merged = mergeOverDefaults(DEFAULT_BINDINGS, profile);
    expect(merged).toMatchObject({
      format: PROFILE_FORMAT,
      version: 1,
      name: "Team keys",
      description: "Shared keys",
      vimMode: true,
    });
    expect(merged.bindings).toEqual(DEFAULT_BINDINGS);
    expect(profile.bindings).toEqual([]);
  });
});

describe("profile helpers", () => {
  it("names the file after the profile", () => {
    expect(profileFileName(BUILT_IN_PROFILES["mouse-friendly"])).toBe(
      "rim-keybinds-mouse-friendly.json",
    );
    expect(profileFileName({ ...BUILT_IN_PROFILES.vim, name: "***" })).toBe(
      "rim-keybinds-profile.json",
    );
  });

  it("compares bindings regardless of order, and the Vim switch", () => {
    const vim = BUILT_IN_PROFILES.vim;
    const reversed = { ...vim, name: "Other", bindings: [...vim.bindings].reverse() };
    expect(sameBindings(vim, reversed)).toBe(true);
    expect(sameBindings(vim, BUILT_IN_PROFILES.minimal)).toBe(false);
  });
});
