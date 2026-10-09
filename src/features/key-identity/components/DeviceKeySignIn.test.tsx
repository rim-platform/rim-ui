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
  signInWithDeviceKey: vi.fn(),
  forgetDeviceKeys: vi.fn(),
  forgetKeysTheServerNeverSaw: vi.fn(),
  recoverAccount: vi.fn(),
  defaultDeviceName: vi.fn(),
}));
const desktop = vi.hoisted(() => ({ value: true }));
const web = vi.hoisted(() => ({ value: false }));

vi.mock("../api/keyIdentity", async () => {
  const actual = await vi.importActual<typeof import("../api/keyIdentity")>("../api/keyIdentity");
  return { ...actual, ...api };
});
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () =>
    web.value
      ? { platform: "web", capabilities: { deviceKeys: true, identityKeys: false } }
      : {
          platform: "desktop",
          capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value },
        },
}));
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
  getApiOrigin: () => "http://localhost:8080",
}));

import { DeviceKeySignIn, RecoverAccount } from "./DeviceKeySignIn";

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
    api.listDeviceKeyAccounts.mockResolvedValue([alice]);
    api.forgetDeviceKeys.mockResolvedValue(undefined);
    api.forgetKeysTheServerNeverSaw.mockResolvedValue(false);
  });

  it("signs in with this device's key", async () => {
    api.signInWithDeviceKey.mockResolvedValue("u-alice");
    const onSuccess = vi.fn();
    wrap(<DeviceKeySignIn onSuccess={onSuccess} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in as alice/i }));

    expect(api.signInWithDeviceKey).toHaveBeenCalledWith("rimp1_alice");
    expect(onSuccess).toHaveBeenCalledWith("u-alice");
  });

  it("offers to remove the keys of a device the account removed", async () => {
    api.signInWithDeviceKey.mockRejectedValue(forbidden());
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in as alice/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/device was removed/i);

    api.listDeviceKeyAccounts.mockResolvedValue([]);
    await userEvent.click(screen.getByRole("button", { name: /remove this device's keys/i }));

    expect(api.forgetDeviceKeys).toHaveBeenCalledWith("rimp1_alice");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /sign in as alice/i })).toBeNull(),
    );
  });

  it("shows other failures without offering removal", async () => {
    api.signInWithDeviceKey.mockRejectedValue(new Error("Keyring locked"));
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in as alice/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove this device's keys/i })).toBeNull();
    // The server knows these keys' account: they stay.
    expect(api.forgetKeysTheServerNeverSaw).toHaveBeenCalledWith(alice);
    expect(screen.getByRole("button", { name: /sign in as alice/i })).toBeInTheDocument();
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
    api.signInWithDeviceKey.mockRejectedValue(new Error("unauthenticated"));
    api.forgetKeysTheServerNeverSaw.mockImplementation(async () => {
      api.listDeviceKeyAccounts.mockResolvedValue([]);
      return true;
    });
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /sign in as ada/i }));

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
    api.signInWithDeviceKey.mockRejectedValue(forbidden());
    wrap(<DeviceKeySignIn onSuccess={vi.fn()} />);

    expect(await screen.findByText(/keys kept in a browser are weaker/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign in as alice/i }));
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
    api.defaultDeviceName.mockResolvedValue("Laptop");
  });

  const ACCOUNT = `rimp1_${"a".repeat(43)}`;

  it("recovers with a pasted v2 kit and fills in its account id", async () => {
    api.recoverAccount.mockResolvedValue("u-alice");
    const onSuccess = vi.fn();
    wrap(<RecoverAccount onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    const kit =
      `RIM recovery kit (v2)\nAccount id: ${ACCOUNT}\n` +
      "Recovery phrase: abandon amount liar amount expire adjust cage candy arch gather drum buyer\n";
    await userEvent.click(screen.getByLabelText(/recovery kit/i));
    await userEvent.paste(kit);
    expect(screen.getByLabelText(/^account id/i)).toHaveValue(ACCOUNT);
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));

    expect(api.recoverAccount).toHaveBeenCalledWith(kit, ACCOUNT, "Laptop");
    expect(onSuccess).toHaveBeenCalledWith("u-alice");
  });

  it("lets a pasted kit's account id replace one typed before", async () => {
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await userEvent.type(screen.getByLabelText(/^account id/i), "rimp1_typed");
    await userEvent.click(screen.getByLabelText(/recovery kit/i));
    await userEvent.paste(`RIM recovery kit (v1)\nAccount id: ${ACCOUNT}\nRecovery key: RK1-AAAA`);
    expect(screen.getByLabelText(/^account id/i)).toHaveValue(ACCOUNT);
  });

  it("asks for the account id when only the phrase is typed", async () => {
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await userEvent.type(screen.getByLabelText(/recovery kit/i), "1. abandon 2. amount");

    const submit = screen.getByRole("button", { name: /^recover account$/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^account id/i), "rimp1_x");
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("shows why recovery failed", async () => {
    api.recoverAccount.mockRejectedValue(
      new Error('word 5 of the recovery phrase, "zzzq", is not in the word list'),
    );
    wrap(<RecoverAccount onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /recover an account/i }));
    await userEvent.type(screen.getByLabelText(/recovery kit/i), "RK1-AAAA");
    await userEvent.type(screen.getByLabelText(/^account id/i), "rimp1_x");
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByRole("button", { name: /^recover account$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/word 5 .*not in the word list/i);
  });

  it("is not offered in the web app, even with device keys", () => {
    web.value = true;
    const { container } = wrap(<RecoverAccount onSuccess={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
