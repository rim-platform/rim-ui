import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import type { OfferToConfirm, StartedLink } from "../api/deviceLink";
import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  startLinkingDevice: vi.fn(),
  waitForOffer: vi.fn(),
  confirmLink: vi.fn(),
  cancelLink: vi.fn(),
  declineLink: vi.fn(),
}));

vi.mock("../api/deviceLink", async () => {
  const actual = await vi.importActual<typeof import("../api/deviceLink")>("../api/deviceLink");
  return { ...actual, ...api };
});

import { DEVICE_LINK_MESSAGES, DeviceLinkError } from "../api/deviceLink";
import { LinkDevicePanel } from "./LinkDevicePanel";

const CODE =
  "rim-link:1:AAECAwQFBgcICQoLDA0ODw:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8:http://localhost:8080/api";
const link: StartedLink = {
  linkId: "AAECAwQFBgcICQoLDA0ODw",
  code: CODE,
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  principalId: "rimp1_alice",
};
const offer: OfferToConfirm = {
  deviceId: "d-new",
  name: "Laptop",
  platform: "desktop",
  fingerprint: "QSFX-VHMA",
};
const identity: MyKeyIdentity = {
  principalId: "rimp1_alice",
  keySeq: 0,
  keyLog: [],
  devices: [],
  profileCard: null,
};

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LinkDevicePanel", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.startLinkingDevice.mockResolvedValue(link);
    api.cancelLink.mockResolvedValue(false);
    api.declineLink.mockResolvedValue(undefined);
  });

  it("shows the code as a QR code and as text, then the offer to confirm", async () => {
    const pending = deferred<OfferToConfirm>();
    api.waitForOffer.mockReturnValue(pending.promise);
    api.confirmLink.mockResolvedValue(undefined);
    const { container } = wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);

    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));

    expect(await screen.findByLabelText("Device link code")).toHaveTextContent(CODE);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/expires in \d+:\d\d/i)).toBeInTheDocument();
    expect(api.startLinkingDevice).toHaveBeenCalledWith(identity);

    pending.resolve(offer);
    expect(await screen.findByLabelText("Fingerprint")).toHaveTextContent("QSFX-VHMA");
    expect(screen.getByText("The desktop app.")).toBeInTheDocument();

    const name = screen.getByLabelText(/device name/i);
    expect(name).toHaveValue("Laptop");
    await userEvent.clear(name);
    await userEvent.type(name, "Work laptop");
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(api.confirmLink).toHaveBeenCalledWith(
      link,
      "Work laptop",
      "Alice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await screen.findByText("Work laptop is linked.")).toBeInTheDocument();
  });

  it("says that keys in a browser are weaker", async () => {
    api.waitForOffer.mockResolvedValue({ ...offer, platform: "web" });
    wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));
    expect(await screen.findByText(/keys in a browser are weaker/i)).toBeInTheDocument();
  });

  it("cancels the link when the person declines", async () => {
    api.waitForOffer.mockResolvedValue(offer);
    wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));
    await userEvent.click(await screen.findByRole("button", { name: /decline/i }));

    expect(api.cancelLink).toHaveBeenCalledWith(link);
    expect(api.confirmLink).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /link a device/i })).toBeInTheDocument();
  });

  it("cancels a confirmed link with the device it certified", async () => {
    api.waitForOffer.mockResolvedValue(offer);
    const events: string[] = [];
    api.confirmLink.mockImplementation(
      (_link: StartedLink, _name: string, _display: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () => {
            events.push("confirm settled");
            reject(new DeviceLinkError("aborted"));
          }),
        ),
    );
    api.cancelLink.mockImplementation(async () => {
      events.push("cancelLink");
      return false;
    });
    wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    expect(await screen.findByText(/waiting for it to sign in/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(api.cancelLink).toHaveBeenCalledWith(link, "d-new"));
    // The confirm flow settles before the link is cancelled and its device revoked.
    expect(events).toEqual(["confirm settled", "cancelLink"]);
  });

  it("keeps a confirmed link going when the panel closes", async () => {
    api.waitForOffer.mockResolvedValue(offer);
    let signal: AbortSignal | undefined;
    api.confirmLink.mockImplementation(
      (_link: StartedLink, _name: string, _display: string, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => undefined);
      },
    );
    const { unmount } = wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    unmount();
    expect(signal?.aborted).toBe(false);
    expect(api.declineLink).not.toHaveBeenCalled();
    expect(api.cancelLink).not.toHaveBeenCalled();
  });

  it("declines an offer still waiting for confirmation when the panel closes", async () => {
    api.waitForOffer.mockResolvedValue(offer);
    const { unmount } = wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));
    await screen.findByLabelText("Fingerprint");
    unmount();
    expect(api.declineLink).toHaveBeenCalledWith(link);
  });

  it("offers a retry after a network failure past Confirm", async () => {
    api.waitForOffer.mockResolvedValue(offer);
    api.confirmLink
      .mockRejectedValueOnce(new DeviceLinkError("failed", "fetch failed"))
      .mockResolvedValueOnce(undefined);
    wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("fetch failed");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(api.confirmLink).toHaveBeenCalledTimes(2);
    expect(api.confirmLink.mock.calls[1].slice(0, 3)).toEqual([link, "Laptop", "Alice"]);
    expect(await screen.findByText("Laptop is linked.")).toBeInTheDocument();
  });

  it("shows why a link failed and starts again", async () => {
    api.waitForOffer.mockRejectedValue(new DeviceLinkError("expired"));
    wrap(<LinkDevicePanel identity={identity} displayName="Alice" />);
    await userEvent.click(screen.getByRole("button", { name: /link a device/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(DEVICE_LINK_MESSAGES.expired);
    await userEvent.click(screen.getByRole("button", { name: /start again/i }));
    expect(screen.getByRole("button", { name: /link a device/i })).toBeInTheDocument();
  });
});
