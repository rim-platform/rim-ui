import { afterEach, describe, expect, it } from "vitest";

import { forgetMacroMoves, macroMoveAccount, readMacroMoves, recordMacroMoves } from "./macroMoves";

afterEach(() => localStorage.clear());

describe("the record of moved macros", () => {
  it("keeps each moved workspace macro's new id, per account", () => {
    expect(readMacroMoves("u-1")).toEqual({});

    expect(recordMacroMoves("u-1", { "m-1": "user.standup" })).toBe(true);
    recordMacroMoves("u-1", { "m-2": "user.triage" });

    expect(readMacroMoves("u-1")).toEqual({ "m-1": "user.standup", "m-2": "user.triage" });
    expect(readMacroMoves("u-2")).toEqual({});
    expect(localStorage.getItem(`rim.macroMoves.${macroMoveAccount("u-1")}`)).not.toBeNull();
  });

  it("reads nothing from a damaged record and forgets a removed account's", () => {
    localStorage.setItem(`rim.macroMoves.${macroMoveAccount("u-1")}`, "[1, 2]");
    expect(readMacroMoves("u-1")).toEqual({});

    recordMacroMoves("u-1", { "m-1": "user.standup" });
    forgetMacroMoves("u-1");
    expect(readMacroMoves("u-1")).toEqual({});
  });
});
