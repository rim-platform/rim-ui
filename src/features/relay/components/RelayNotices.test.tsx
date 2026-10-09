import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useRelayStore } from "../state/useRelayStore";

const processor = vi.hoisted(() => ({ reconcileSpace: vi.fn() }));
vi.mock("../runtime/relayRuntime", () => ({ relayProcessor: () => processor }));

import { RelayNotices } from "./RelayNotices";

beforeEach(() => {
  processor.reconcileSpace.mockReset();
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

  it("says messages may be missing, retries, and offers a direct connection later", async () => {
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
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(processor.reconcileSpace).toHaveBeenCalledWith("home-direct");
  });
});
