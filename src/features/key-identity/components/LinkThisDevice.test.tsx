import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import type { LinkNewDeviceOptions } from "../api/deviceLink";

const api = vi.hoisted(() => ({ linkNewDevice: vi.fn() }));
const keys = vi.hoisted(() => ({ defaultDeviceName: vi.fn() }));
const deviceKeys = vi.hoisted(() => ({ value: true }));
const deviceKeySignIn = vi.hoisted(() => ({ value: true }));
const browser = vi.hoisted(() => ({ supported: true }));

vi.mock("../api/deviceLink", async () => {
  const actual = await vi.importActual<typeof import("../api/deviceLink")>("../api/deviceLink");
  return { ...actual, ...api };
});
vi.mock("../api/keyIdentity", async () => {
  const actual = await vi.importActual<typeof import("../api/keyIdentity")>("../api/keyIdentity");
  return { ...actual, ...keys };
});
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    capabilities: { deviceKeys: deviceKeys.value, deviceKeySignIn: deviceKeySignIn.value },
  }),
}));
vi.mock("../api/browserKeys", async () => ({
  ...(await vi.importActual<typeof import("../api/browserKeys")>("../api/browserKeys")),
  browserKeysSupported: () => Promise.resolve(browser.supported),
}));
vi.mock("./QrScanner", () => ({
  QrScanner: ({ onCode }: { onCode: (code: string) => void }) => (
    <button type="button" onClick={() => onCode("rim-link:1:scanned")}>
      fake camera
    </button>
  ),
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
    deviceKeys.value = true;
    deviceKeySignIn.value = true;
    browser.supported = true;
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

  it("takes only a pasted code on the desktop", async () => {
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /link this device with its code/i }));
    await screen.findByLabelText(/link code/i);
    expect(screen.queryByRole("button", { name: /scan the code/i })).toBeNull();
    expect(screen.queryByText(/less safely than the desktop app/i)).toBeNull();
  });

  it("scans the code with the camera in the web app and warns about browser keys", async () => {
    deviceKeys.value = false;
    api.linkNewDevice.mockResolvedValue("u-alice");
    const onSuccess = vi.fn();
    wrap(<LinkThisDevice onSuccess={onSuccess} />);
    await userEvent.click(screen.getByRole("button", { name: /link this device with its code/i }));
    expect(await screen.findByText(/less safely than the desktop app/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );

    await userEvent.click(screen.getByRole("button", { name: /scan the code/i }));
    await userEvent.click(screen.getByRole("button", { name: /fake camera/i }));
    expect(api.linkNewDevice).toHaveBeenCalledWith(
      "rim-link:1:scanned",
      "Laptop",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-alice"));
  });

  it("says when the browser cannot keep a device key", async () => {
    deviceKeys.value = false;
    browser.supported = false;
    wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /link this device with its code/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot keep a device key/i);
    expect(screen.queryByRole("button", { name: /scan the code/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^link this device$/i })).toBeDisabled();
  });

  it("renders nothing where this app cannot hold a device key", () => {
    deviceKeys.value = false;
    deviceKeySignIn.value = false;
    const { container } = wrap(<LinkThisDevice onSuccess={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
