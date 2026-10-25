import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import type { LocalKeyAccount } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  listDeviceKeyAccounts: vi.fn(),
  signInWithPassword: vi.fn(),
  forgetDeviceKeys: vi.fn(),
  forgetKeysTheServerNeverSaw: vi.fn(),
  recoverDeviceKeys: vi.fn(),
  defaultDeviceName: vi.fn(),
}));
const changes = vi.hoisted(() => ({ resetPassword: vi.fn() }));
const desktop = vi.hoisted(() => ({ value: true }));
const web = vi.hoisted(() => ({ value: false }));

vi.mock("../api/keyIdentity", async () => {
  const actual = await vi.importActual<typeof import("../api/keyIdentity")>("../api/keyIdentity");
  return { ...actual, ...api };
});
vi.mock("../../auth/runtime/passwordChanges", () => changes);
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () =>
    web.value
      ? { platform: "web", capabilities: { deviceKeys: true, identityKeys: true } }
      : {
          platform: "desktop",
          capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value },
        },
}));
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
  getApiOrigin: () => "http://localhost:8080",
}));

import {
  PasswordLockedError,
  PasswordWaitError,
  WrongPasswordError,
} from "../../auth/api/passwordApi";
import { START_EMPTY_EXPLANATION } from "../../auth/password";
import type { PasswordSignInOptions } from "../api/keyIdentity";
import { DeviceKeySignIn, RecoverAccount } from "./DeviceKeySignIn";

const PASSWORD = "correct horse battery";
const PHRASE = "abandon amount liar amount expire adjust cage candy arch gather drum buyer";
const SIGNED_IN = { userId: "u-alice", startedEmpty: false };

/** Opens alice's password prompt and signs in with `password`. */
async function signInAsAlice(password = PASSWORD) {
  await userEvent.click(await screen.findByRole("button", { name: /sign in as alice/i }));
  await userEvent.type(screen.getByLabelText(/^password or pin$/i), password);
  await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
}

/** Types a new passphrase, twice. */
async function typeNewPassphrase(password = PASSWORD) {
  await userEvent.type(screen.getByLabelText("Passphrase"), password);
  await userEvent.type(screen.getByLabelText("Passphrase again"), password);
}

const alice: LocalKeyAccount = {
  principalId: "rimp1_alice",
  userId: "u-alice",
  username: "alice",
  deviceId: "d-1",
  deviceName: "Laptop",
  hasIdentityKey: true,
  confirmed: true,
};

const forbidden = () =>
  new ClientError(
    {
      status: 200,
      headers: new Headers(),
      errors: [{ message: "device revoked", extensions: { code: "FORBIDDEN" } }],
    },
    { query: "mutation LoginWithKey { loginWithKey }" },
  );

function wrap(ui: ReactNode) {
  const qc = createTestQueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("DeviceKeySignIn", () => {
  beforeEach(() => {
    desktop.value = true;
    web.value = false;
    Object.values(api).forEach((fn) => fn.mockReset());
    changes.resetPassword.mockReset();
    api.listDeviceKeyAccounts.mockResolvedValue([alice]);
    api.forgetDeviceKeys.mockResolvedValue(undefined);
    api.forgetKeysTheServerNeverSaw.mockResolvedValue(false);
  });

  it("opens a password prompt and signs in with the password and this device's key", async () => {
    api.signInWithPassword.mockResolvedValue(SIGNED_IN);
    const onSuccess = vi.fn();
    wrap(<DeviceKeySignIn onSuccess={onSuccess} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in as alice/i }));
    // Nothing opens with one click: the prompt asks for the password first.
    expect(api.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /keep me signed in/i })).not.toBeChecked();
    await userEvent.type(screen.getByLabelText(/^password or pin$/i), PASSWORD);
    await userEvent.click(screen.getByRole("checkbox", { name: /keep me signed in/i }));
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(api.signInWithPassword).toHaveBeenCalledWith(
      "rimp1_alice",
      { password: PASSWORD, keep: true },
      { onNeedsRecovery: expect.any(Function) },
    );
    expect(onSuccess).toHaveBeenCalledWith("u-alice");
  });

  it("says a wrong password and clears the field", async () => {
    api.signInWithPassword.mockRejectedValue(new WrongPasswordError());
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await signInAsAlice();

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password");
    expect(screen.getByLabelText(/^password or pin$/i)).toHaveValue("");
    // The server knows these keys' account: they stay.
    expect(api.forgetKeysTheServerNeverSaw).toHaveBeenCalledWith(alice);
  });

  it("says how long to wait after too many wrong tries", async () => {
    api.signInWithPassword.mockRejectedValue(new PasswordWaitError(540));
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await signInAsAlice();

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 9 minutes");
    expect(api.forgetKeysTheServerNeverSaw).not.toHaveBeenCalled();
  });

  it("sends a locked password to the recovery phrase, which sets a new one and signs in", async () => {
    api.signInWithPassword.mockRejectedValueOnce(new PasswordLockedError());
    api.signInWithPassword.mockResolvedValueOnce(SIGNED_IN);
    changes.resetPassword.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    wrap(<DeviceKeySignIn onSuccess={onSuccess} />);

    await signInAsAlice();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many wrong tries. Use your recovery phrase to set a new password.",
    );
    await userEvent.click(screen.getByRole("button", { name: /use your recovery phrase/i }));
    await userEvent.type(screen.getByLabelText(/recovery phrase/i), PHRASE);
    await typeNewPassphrase("a brand new passphrase");
    await userEvent.click(screen.getByRole("button", { name: /set the new password/i }));

    expect(changes.resetPassword).toHaveBeenCalledWith(
      "rimp1_alice",
      expect.any(Uint8Array),
      "a brand new passphrase",
    );
    const entropy = changes.resetPassword.mock.calls[0][1] as Uint8Array;
    expect(entropy).toHaveLength(16);
    expect(api.signInWithPassword).toHaveBeenLastCalledWith(
      "rimp1_alice",
      { password: "a brand new passphrase", keep: false },
      { recoveryEntropy: entropy, onNeedsRecovery: expect.any(Function) },
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-alice"));
  });

  it("asks for the recovery phrase when this device's data needs it, or starts empty", async () => {
    api.signInWithPassword.mockImplementation(
      async (_principal: string, _entry: unknown, options: PasswordSignInOptions) => {
        const choice = await options.onNeedsRecovery?.(false);
        return { ...SIGNED_IN, startedEmpty: choice === "startEmpty" };
      },
    );
    const onSuccess = vi.fn();
    wrap(<DeviceKeySignIn onSuccess={onSuccess} />);

    await signInAsAlice();
    expect(await screen.findByText(/your recovery phrase is needed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start empty on this device/i }));
    // What starting empty loses is said before it happens.
    expect(screen.getByText(START_EMPTY_EXPLANATION)).toBeInTheDocument();
    expect(START_EMPTY_EXPLANATION).toMatch(/cached messages/);
    expect(START_EMPTY_EXPLANATION).toMatch(/sign-in key/);
    expect(START_EMPTY_EXPLANATION).toMatch(/stay signed in/);
    expect(onSuccess).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^start empty$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-alice"));
  });

  it("unlocks with the recovery phrase typed at that question", async () => {
    let answered: unknown = null;
    api.signInWithPassword.mockImplementation(
      async (_principal: string, _entry: unknown, options: PasswordSignInOptions) => {
        answered = await options.onNeedsRecovery?.(false);
        return SIGNED_IN;
      },
    );
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await signInAsAlice();
    await userEvent.type(await screen.findByLabelText(/recovery phrase/i), "not a phrase");
    await userEvent.click(screen.getByRole("button", { name: /unlock with the phrase/i }));
    expect(await screen.findByText(/a recovery phrase has 12 words/i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/recovery phrase/i));
    await userEvent.type(screen.getByLabelText(/recovery phrase/i), PHRASE);
    await userEvent.click(screen.getByRole("button", { name: /unlock with the phrase/i }));

    await waitFor(() => expect(answered).toEqual({ entropy: expect.any(Uint8Array) }));
  });

  it("offers to remove the keys of a device the account removed", async () => {
    api.signInWithPassword.mockRejectedValue(forbidden());
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await signInAsAlice();
    expect(await screen.findByRole("alert")).toHaveTextContent(/device was removed/i);

    api.listDeviceKeyAccounts.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: /remove this device's keys/i }));

    expect(api.forgetDeviceKeys).toHaveBeenCalledWith("rimp1_alice");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /sign in as alice/i })).toBeNull(),
    );
  });

  it("shows other failures without offering removal", async () => {
    api.signInWithPassword.mockRejectedValue(new Error("Keyring locked"));
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await signInAsAlice();

    expect(await screen.findByRole("alert")).toHaveTextContent("Keyring locked");
    expect(screen.queryByRole("button", { name: /remove this device's keys/i })).toBeNull();
    expect(api.forgetKeysTheServerNeverSaw).toHaveBeenCalledWith(alice);
  });

  it("removes the keys of a sign-up that never reached the server, and says so", async () => {
    const unfinished: LocalKeyAccount = {
      ...alice,
      principalId: "rimp1_ada",
      userId: null,
      username: "ada",
      confirmed: false,
    };
    api.listDeviceKeyAccounts.mockResolvedValue([unfinished]);
    api.signInWithPassword.mockRejectedValue(new WrongPasswordError());
    api.forgetKeysTheServerNeverSaw.mockImplementation(async () => {
      api.listDeviceKeyAccounts.mockResolvedValue([]);
      return true;
    });
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in as ada/i }));
    await userEvent.type(screen.getByLabelText(/^password or pin$/i), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(api.forgetKeysTheServerNeverSaw).toHaveBeenCalledWith(unfinished);
    expect(await screen.findByRole("status")).toHaveTextContent(/sign-up of ada never completed/i);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /sign in as ada/i })).toBeNull(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing without device keys", () => {
    desktop.value = false;
    const { container } = wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.listDeviceKeyAccounts).not.toHaveBeenCalled();
  });

  it("signs in a linked browser, with the weaker-keys notice", async () => {
    web.value = true;
    const linked = { ...alice, hasIdentityKey: false };
    api.listDeviceKeyAccounts.mockResolvedValue([linked]);
    api.signInWithPassword.mockRejectedValue(forbidden());
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    expect(await screen.findByText(/keys kept in a browser are weaker/i)).toBeInTheDocument();
    await signInAsAlice();
    await userEvent.click(
      await screen.findByRole("button", { name: /remove this device's keys from this browser/i }),
    );
    expect(api.forgetDeviceKeys).toHaveBeenCalledWith("rimp1_alice");
  });
});

describe("RecoverAccount", () => {
  beforeEach(() => {
    desktop.value = true;
    web.value = false;
    Object.values(api).forEach((fn) => fn.mockReset());
    changes.resetPassword.mockReset();
    api.defaultDeviceName.mockResolvedValue("Laptop");
  });

  const ACCOUNT = `rimp1_${"a".repeat(43)}`;
  const KIT = `RIM recovery kit (v2)\nAccount id: ${ACCOUNT}\nRecovery phrase: ${PHRASE}\n`;

  async function openWithKit(kit = KIT) {
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByLabelText(/recovery kit/i));
    await userEvent.paste(kit);
  }

  it("recovers with a pasted v2 kit and the password the person knows", async () => {
    api.recoverDeviceKeys.mockResolvedValue(ACCOUNT);
    api.signInWithPassword.mockResolvedValue(SIGNED_IN);
    const onSuccess = vi.fn();
    wrap(<RecoverAccount onSuccess={onSuccess} />);

    await openWithKit();
    expect(screen.getByLabelText(/^account id/i)).toHaveValue(ACCOUNT);
    expect(screen.getByRole("radio", { name: /i know my password/i })).toBeChecked();
    await userEvent.type(screen.getByLabelText(/^password or pin$/i), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));

    expect(api.recoverDeviceKeys).toHaveBeenCalledWith(KIT, ACCOUNT, "Laptop");
    expect(changes.resetPassword).not.toHaveBeenCalled();
    expect(api.signInWithPassword).toHaveBeenCalledWith(
      ACCOUNT,
      { password: PASSWORD, keep: false },
      { recoveryEntropy: expect.any(Uint8Array) },
    );
    expect(onSuccess).toHaveBeenCalledWith("u-alice");
  });

  it("sets a new password with the phrase after recovering, then signs in with it", async () => {
    api.recoverDeviceKeys.mockResolvedValue(ACCOUNT);
    api.signInWithPassword.mockResolvedValue(SIGNED_IN);
    changes.resetPassword.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    wrap(<RecoverAccount onSuccess={onSuccess} />);

    await openWithKit();
    await userEvent.click(screen.getByRole("radio", { name: /set a new password/i }));
    await userEvent.type(screen.getByLabelText("Passphrase"), "short");
    await userEvent.type(screen.getByLabelText("Passphrase again"), "short");
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));
    expect(await screen.findByText(/at least 12 characters\./i)).toBeInTheDocument();
    expect(api.recoverDeviceKeys).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("Passphrase"));
    await userEvent.clear(screen.getByLabelText("Passphrase again"));
    await typeNewPassphrase();
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));

    expect(changes.resetPassword).toHaveBeenCalledWith(ACCOUNT, expect.any(Uint8Array), PASSWORD);
    expect(api.recoverDeviceKeys.mock.invocationCallOrder[0]).toBeLessThan(
      changes.resetPassword.mock.invocationCallOrder[0],
    );
    expect(api.signInWithPassword).toHaveBeenCalledWith(
      ACCOUNT,
      { password: PASSWORD, keep: false },
      { recoveryEntropy: expect.any(Uint8Array) },
    );
    expect(onSuccess).toHaveBeenCalledWith("u-alice");
  });

  it("needs the 12-word phrase to set a new password", async () => {
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await openWithKit(`RIM recovery kit (v1)\nAccount id: ${ACCOUNT}\nRecovery key: RK1-AAAA`);
    await userEvent.click(screen.getByRole("radio", { name: /set a new password/i }));
    await typeNewPassphrase();
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs the 12-word recovery phrase/);
    expect(api.recoverDeviceKeys).not.toHaveBeenCalled();
  });

  it("signs in again without recovering twice after a wrong password", async () => {
    api.recoverDeviceKeys.mockResolvedValue(ACCOUNT);
    api.signInWithPassword.mockRejectedValueOnce(new WrongPasswordError());
    api.signInWithPassword.mockResolvedValueOnce(SIGNED_IN);
    const onSuccess = vi.fn();
    wrap(<RecoverAccount onSuccess={onSuccess} />);

    await openWithKit();
    await userEvent.type(screen.getByLabelText(/^password or pin$/i), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Wrong password/);

    await userEvent.type(screen.getByLabelText(/^password or pin$/i), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-alice"));
    expect(api.recoverDeviceKeys).toHaveBeenCalledTimes(1);
  });

  it("lets a pasted kit's account id replace one typed before", async () => {
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await userEvent.type(screen.getByLabelText(/^account id/i), "rimp1_typed");
    await userEvent.click(screen.getByLabelText(/recovery kit/i));
    await userEvent.paste(`RIM recovery kit (v1)\nAccount id: ${ACCOUNT}\nRecovery key: RK1-AAAA`);
    expect(screen.getByLabelText(/^account id/i)).toHaveValue(ACCOUNT);
  });

  it("asks for the account id and the password when only the phrase is typed", async () => {
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await userEvent.type(screen.getByLabelText(/recovery kit/i), "1. abandon 2. amount");

    const submit = screen.getByRole("button", { name: /^recover account$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^account id/i), "rimp1_x");
    await userEvent.type(screen.getByLabelText(/^password or pin$/i), PASSWORD);
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("shows why recovery failed", async () => {
    api.recoverDeviceKeys.mockRejectedValue(
      new Error('word 5 of the recovery phrase, "zzzq", is not in the word list'),
    );
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await userEvent.type(screen.getByLabelText(/recovery kit/i), "RK1-AAAA");
    await userEvent.type(screen.getByLabelText(/^account id/i), "rimp1_x");
    await userEvent.type(screen.getByLabelText(/^password or pin$/i), PASSWORD);
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/word 5 .*not in the word list/i);
    expect(api.signInWithPassword).not.toHaveBeenCalled();
  });

  it("is offered in a browser that can hold keys, and not where no keys can be held", () => {
    web.value = true;
    const { unmount } = wrap(<RecoverAccount onSuccess={vi.fn()} />);
    expect(screen.getByRole("button", { name: /recover an account/i })).toBeInTheDocument();
    unmount();
    web.value = false;
    desktop.value = false;
    const { container } = wrap(<RecoverAccount onSuccess={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
