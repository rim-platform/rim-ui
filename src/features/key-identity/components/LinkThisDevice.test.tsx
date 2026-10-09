import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import type { LinkNewDeviceOptions } from "../api/deviceLink";

const api = vi.hoisted(() => ({ linkNewDevice: vi.fn() }));
const keys = vi.hoisted(() => ({ defaultDeviceName: vi.fn() }));
const runtime = vi.hoisted(() => ({
  platform: "desktop",
  deviceKeyStore: "keyring",
  capabilities: { deviceKeys: true },
}));

vi.mock("../api/deviceLink", async () => {
  const actual = await vi.importActual<typeof import("../api/deviceLink")>("../api/deviceLink");
  return { ...actual, ...api };
});
vi.mock("../api/keyIdentity", async () => {
  const actual = await vi.importActual<typeof import("../api/keyIdentity")>("../api/keyIdentity");
  return { ...actual, ...keys };
});
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => runtime,
}));
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
  getApiOrigin: () => "http://localhost:8080",
}));

import { DEVICE_LINK_MESSAGES, DeviceLinkError } from "../api/deviceLink";
import { LinkThisDevice } from "./LinkThisDevice";

const CODE = "rim-link:1:AAECAwQFBgcICQoLDA0ODw:secret:http://localhost:8080/api";

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}

async function openAndSubmit() {
  await userEvent.click(screen.getByRole("button", { name: /link this device with its code/i }));
  await waitFor(() => expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"));
  await userEvent.click(screen.getByLabelText(/link code/i));
  await userEvent.paste(CODE);
  await userEvent.click(screen.getByRole("button", { name: /^link this device$/i }));
}

describe("LinkThisDevice", () => {
  beforeEach(() => {
    Object.assign(runtime, {
      platform: "desktop",
      deviceKeyStore: "keyring",
      capabilities: { deviceKeys: true },
    });
    api.linkNewDevice.mockReset();
    keys.defaultDeviceName.mockResolvedValue("Laptop");
  });

  it("shows the fingerprint while waiting, then signs in", async () => {
    let finish!: (userId: string) => void;
    api.linkNewDevice.mockImplementation(
      (_code: string, _name: string, options: LinkNewDeviceOptions) => {
        options.onOffered?.({ linkId: "l", fingerprint: "QSFX-VHMA" });
        return new Promise<string>((resolve) => {
          finish = resolve;
        });
      },
    );
    const onSuccess = vi.fn();
    wrap(<LinkThisDevice onSuccess={onSuccess} />);

    await openAndSubmit();

    expect(api.linkNewDevice).toHaveBeenCalledWith(
      CODE,
      "Laptop",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await screen.findByLabelText("Fingerprint")).toHaveTextContent("QSFX-VHMA");
    expect(screen.getByText(/confirm this code on your other device/i)).toBeInTheDocument();

    finish("u-alice");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-alice"));
  });

  it("explains a code that was used up", async () => {
    api.linkNewDevice.mockRejectedValue(new DeviceLinkError("codeUnusable"));
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    await openAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(DEVICE_LINK_MESSAGES.codeUnusable);
  });

  it("explains a device the other device removed", async () => {
    api.linkNewDevice.mockRejectedValue(new DeviceLinkError("revoked"));
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    await openAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(DEVICE_LINK_MESSAGES.revoked);
  });

  it("aborts the link when cancelled while waiting", async () => {
    let signal: AbortSignal | undefined;
    api.linkNewDevice.mockImplementation(
      (_code: string, _name: string, options: LinkNewDeviceOptions) => {
        signal = options.signal;
        return new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () => reject(new DeviceLinkError("aborted"))),
        );
      },
    );
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    await openAndSubmit();
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(signal?.aborted).toBe(true);
    // The code is spent.
    await waitFor(() => expect(screen.getByLabelText(/link code/i)).toHaveValue(""));
  });

  it("renders nothing without device keys", () => {
    Object.assign(runtime, { deviceKeyStore: "none", capabilities: { deviceKeys: false } });
    const { container } = wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links a browser, saying its keys are weaker and that a reload abandons the link", async () => {
    Object.assign(runtime, { platform: "web", deviceKeyStore: "browser" });
    api.linkNewDevice.mockImplementation(
      (_code: string, _name: string, options: LinkNewDeviceOptions) => {
        options.onOffered?.({ linkId: "l", fingerprint: "QSFX-VHMA" });
        return new Promise<string>(() => undefined);
      },
    );
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /link this browser with its code/i }));
    expect(screen.getByText(/keys kept in a browser are weaker/i)).toBeInTheDocument();
    expect(screen.getByText(/this browser gets its own key/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await userEvent.click(screen.getByLabelText(/link code/i));
    await userEvent.paste(CODE);
    await userEvent.click(screen.getByRole("button", { name: /^link this device$/i }));
    expect(await screen.findByLabelText("Fingerprint")).toHaveTextContent("QSFX-VHMA");
    expect(screen.getByText(/reloading the page abandons the link/i)).toBeInTheDocument();
  });

  it("says why a browser without Ed25519 cannot be linked", () => {
    Object.assign(runtime, {
      platform: "web",
      deviceKeyStore: "unsupported",
      capabilities: { deviceKeys: false },
    });
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    expect(screen.getByText(/this browser cannot be linked/i)).toHaveTextContent(/Ed25519/);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
