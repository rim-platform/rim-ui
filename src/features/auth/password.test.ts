import { describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({ value: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => desktop.value,
}));

import { NoDeviceKeysError, SignInCancelled } from "../key-identity/api/keyIdentity";
import { PasswordLockedError, PasswordWaitError, WrongPasswordError } from "./api/passwordApi";
import { KeysUnopenedError } from "./runtime/accountUnlock";
import {
  keepSignedInByDefault,
  newPasswordProblem,
  readPhrase,
  signInFailure,
  type PasswordKind,
} from "./password";

function problem(kind: PasswordKind, password: string, repeat = password) {
  return newPasswordProblem({ kind, password, repeat });
}

describe("a new password", () => {
  it("is a PIN of at least 6 digits, and digits only", () => {
    expect(problem("pin", "12345")).toBe("A PIN has at least 6 digits.");
    expect(problem("pin", "12345a")).toBe("A PIN has digits only.");
    expect(problem("pin", "123456")).toBeNull();
    expect(problem("pin", "0123456789")).toBeNull();
  });

  it("is a passphrase of at least 12 characters", () => {
    expect(problem("passphrase", "eleven char")).toBe("A passphrase has at least 12 characters.");
    expect(problem("passphrase", "twelve chars")).toBeNull();
    // Characters, not UTF-16 units: 11 emoji are 11 characters.
    expect(problem("passphrase", "🔑".repeat(11))).toBe("A passphrase has at least 12 characters.");
  });

  it("must be typed the same twice", () => {
    expect(problem("pin", "123456", "123465")).toBe("The two entries do not match.");
    expect(problem("passphrase", "correct horse battery", "correct horse batery")).toBe(
      "The two entries do not match.",
    );
  });
});

describe("Keep me signed in", () => {
  it("starts ticked on the desktop and unticked in a browser", () => {
    expect(keepSignedInByDefault(true)).toBe(true);
    expect(keepSignedInByDefault(false)).toBe(false);
  });
});

describe("the words of a failed sign-in", () => {
  it("names a wrong password, a wait and the lock, and nothing for a cancel", () => {
    expect(signInFailure(new WrongPasswordError())).toBe("Wrong password");
    expect(signInFailure(new PasswordWaitError(60))).toBe("Try again in 1 minute");
    expect(signInFailure(new PasswordWaitError(3600))).toBe("Try again in 60 minutes");
    expect(signInFailure(new PasswordLockedError())).toBe(
      "Too many wrong tries. Use your recovery phrase to set a new password.",
    );
    expect(signInFailure(new SignInCancelled())).toBeNull();
  });

  it("says keys missing from this browser, or not opening in it, and how to get them back", () => {
    expect(signInFailure(new NoDeviceKeysError())).toBe(
      "The keys of this account are not in this browser. Recover the account with its recovery kit, or link this browser from a device that is signed in.",
    );
    expect(signInFailure(new KeysUnopenedError())).toBe(
      "The keys this browser keeps for this account could not be opened, so nothing was changed. Recover the account with its recovery kit to use it here.",
    );
  });
});

describe("a typed recovery phrase", () => {
  it("reads as its 16 bytes, or says what is wrong with it", async () => {
    const read = await readPhrase(
      "abandon amount liar amount expire adjust cage candy arch gather drum buyer",
    );
    expect("entropy" in read && read.entropy).toHaveLength(16);
    expect(await readPhrase("two words")).toEqual({
      error: "A recovery phrase has 12 words; this one has 2.",
    });
  });
});
