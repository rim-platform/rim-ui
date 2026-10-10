import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useRelayStore } from "../state/useRelayStore";
import {
  DirectConnections,
  setActiveDirect,
  useDirectStore,
  type DirectDeps,
} from "../direct/directConnection";
import {
  browserDirectTransport,
  setDirectTransport,
  type DirectTransport,
} from "../direct/directTransport";

const processor = vi.hoisted(() => ({ reconcileSpace: vi.fn() }));
vi.mock("../runtime/relayRuntime", () => ({ relayProcessor: () => processor }));

import { RelayNotices, WEB_DIRECT_REASON } from "./RelayNotices";

const desktop: DirectTransport = {
  ...browserDirectTransport,
  sessions: true,
  sockets: { open: vi.fn(), send: vi.fn(), close: vi.fn() },
};

function directWith(connect: () => Promise<void>) {
  const connections = new DirectConnections({
    transport: desktop,
    saveConsent: vi.fn(async () => undefined),
  } as unknown as DirectDeps);
  vi.spyOn(connections, "connect").mockImplementation(connect);
  setActiveDirect(connections);
  return connections;
}

beforeEach(() => {
  processor.reconcileSpace.mockReset();
  setDirectTransport(null);
  setActiveDirect(null);
  useDirectStore.getState().reset();
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [{ account: "a", spaceId: "home-direct", hostServerId: "rims1_home", kind: "direct" }],
    );
});

describe("RelayNotices", () => {
  it("shows nothing while all is well", () => {
    const { container } = render(<RelayNotices />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names a server whose identity forked", () => {
    useRelayStore.getState().setOrigin("rims1_home", "https://home.example");
    useRelayStore.getState().markForked("rims1_home");
    render(<RelayNotices />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "https://home.example: This server's identity changed in a way RIM cannot verify",
    );
  });

  it("says messages may be missing, retries, and says why the web cannot connect directly", async () => {
    const user = userEvent.setup();
    useRelayStore.getState().setOrigin("rims1_home", "https://home.example");
    useRelayStore
      .getState()
      .setMissing({ spaceId: "home-direct", hostServerId: "rims1_home", since: 0 });
    render(<RelayNotices />);
    expect(
      screen.getByText("Messages may be missing from direct messages on https://home.example."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect directly/i })).toBeDisabled();
    expect(screen.getByText(WEB_DIRECT_REASON)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(processor.reconcileSpace).toHaveBeenCalledWith("home-direct");
  });

  it("on the desktop, asks with the IP notice before connecting directly", async () => {
    const user = userEvent.setup();
    setDirectTransport(desktop);
    const connections = directWith(async () => {
      useDirectStore.getState().setConnected("rims1_home", 1);
    });
    useRelayStore.getState().setOrigin("rims1_home", "https://home.example");
    useRelayStore
      .getState()
      .setMissing({ spaceId: "home-direct", hostServerId: "rims1_home", since: 0 });
    render(<RelayNotices />);
    await user.click(screen.getByRole("button", { name: "Connect directly" }));
    expect(
      screen.getByText(
        /Connect directly to https:\/\/home\.example\? It will see your IP address\./,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Connect directly" })[1]);
    expect(connections.connect).toHaveBeenCalledWith("rims1_home");
    expect(useDirectStore.getState().consent.rims1_home).toBe("yes");
    expect(
      await screen.findByText(/Connected directly to https:\/\/home\.example\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Messages may be missing/)).not.toBeInTheDocument();
  });

  it("remembers a refusal", async () => {
    const user = userEvent.setup();
    setDirectTransport(desktop);
    const connections = directWith(async () => undefined);
    connections.ask("rims1_home");
    render(<RelayNotices />);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(useDirectStore.getState().consent.rims1_home).toBe("no");
    expect(connections.connect).not.toHaveBeenCalled();
  });
});
