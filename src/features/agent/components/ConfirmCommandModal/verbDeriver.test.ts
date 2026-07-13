import { describe, it, expect } from "vitest";

import { deriveConfirmationVerb, verbMatches } from "./verbDeriver";

describe("deriveConfirmationVerb", () => {
  it("extracts verb from `domain.verb_object` ids", () => {
    expect(deriveConfirmationVerb("chat.delete_message")).toBe("delete");
    expect(deriveConfirmationVerb("chat.create_channel")).toBe("create");
    expect(deriveConfirmationVerb("workspace.uninstall_plugin")).toBe("uninstall");
    expect(deriveConfirmationVerb("incidents.start_incident")).toBe("start");
  });

  it("uses the entire second segment for `domain.verb` ids", () => {
    expect(deriveConfirmationVerb("incidents.start")).toBe("start");
    expect(deriveConfirmationVerb("auth.logout")).toBe("logout");
  });

  it("normalizes to lowercase", () => {
    expect(deriveConfirmationVerb("Chat.DELETE_message")).toBe("delete");
  });

  it("falls back to 'confirm' for malformed ids", () => {
    expect(deriveConfirmationVerb("")).toBe("confirm");
    expect(deriveConfirmationVerb("noseparator")).toBe("confirm");
    expect(deriveConfirmationVerb("trailing.")).toBe("confirm");
    expect(deriveConfirmationVerb(".leading")).toBe("leading");
  });

  it("falls back to 'confirm' for non-string input", () => {
    expect(deriveConfirmationVerb(undefined as unknown as string)).toBe("confirm");
    expect(deriveConfirmationVerb(null as unknown as string)).toBe("confirm");
  });
});

describe("verbMatches", () => {
  it("matches case-insensitively + ignores whitespace", () => {
    expect(verbMatches("delete", "delete")).toBe(true);
    expect(verbMatches("DELETE", "delete")).toBe(true);
    expect(verbMatches("  delete  ", "delete")).toBe(true);
    expect(verbMatches("Delete", "DELETE")).toBe(true);
  });

  it("rejects non-matching strings", () => {
    expect(verbMatches("del", "delete")).toBe(false);
    expect(verbMatches("delete!", "delete")).toBe(false);
    expect(verbMatches("", "delete")).toBe(false);
  });
});
