import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { useToastStore } from "../../../shared/toast";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";
import type { BlockedPrincipalView } from "../api/relayApi";
import { useRelayStore } from "../state/useRelayStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { BlockedPeople } from "./BlockedPeople";

const BLOCKED_AT = "2026-10-20T09:30:00Z";

const DAVE: BlockedPrincipalView = {
  principalId: "rimp1_davedavedavedave",
  userId: "u-dave",
  username: "dave",
  displayName: "Dave D.",
  blockedAt: BLOCKED_AT,
};
const ERIN: BlockedPrincipalView = {
  principalId: "rimp1_erinerinerinerin",
  userId: "u-erin",
  username: "erin",
  displayName: null,
  blockedAt: BLOCKED_AT,
};
const STRANGER: BlockedPrincipalView = {
  principalId: "rimp1_abcdefghijklmnopqrstuvwxyz",
  userId: null,
  username: null,
  displayName: null,
  blockedAt: BLOCKED_AT,
};

beforeEach(() => {
  requestMock.mockReset();
  useToastStore.setState({ toasts: [] });
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
});

describe("BlockedPeople", () => {
  it("lists the people blocked by name, username or short principal id, with the date", async () => {
    routeRequests(requestMock, {
      "query MyBlockedPrincipals": () => ({ myBlockedPrincipals: [DAVE, ERIN, STRANGER] }),
    });
    renderWithProviders(<BlockedPeople />);

    expect(screen.getByRole("heading", { name: "Blocked people" })).toBeInTheDocument();
    expect(await screen.findByText("Dave D.")).toBeInTheDocument();
    expect(screen.getByText("erin")).toBeInTheDocument();
    expect(screen.getByText("rimp1_abcdefgh")).toBeInTheDocument();
    const date = new Date(BLOCKED_AT).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(screen.getAllByText(`Blocked ${date}`)).toHaveLength(3);
  });

  it("unblocks without asking, says so and refreshes the list", async () => {
    let blocked = [DAVE, ERIN];
    routeRequests(requestMock, {
      "query MyBlockedPrincipals": () => ({ myBlockedPrincipals: blocked }),
      "mutation UnblockPrincipal": (vars) => {
        blocked = blocked.filter((b) => b.principalId !== vars.principalId);
        return { unblockPrincipal: true };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<BlockedPeople />);

    await user.click(await screen.findByRole("button", { name: "Unblock Dave D." }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UnblockPrincipal")).toEqual([
        { principalId: DAVE.principalId },
      ]),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]?.title).toBe("Unblocked Dave D."),
    );
    expect(useToastStore.getState().toasts[0]?.description).toBe("They can message you again.");
    await waitFor(() => expect(screen.queryByText("Dave D.")).not.toBeInTheDocument());
    expect(screen.getByText("erin")).toBeInTheDocument();
  });

  it("says when nobody is blocked", async () => {
    routeRequests(requestMock, {
      "query MyBlockedPrincipals": () => ({ myBlockedPrincipals: [] }),
    });
    renderWithProviders(<BlockedPeople />);

    expect(await screen.findByText("You haven't blocked anyone.")).toBeInTheDocument();
  });

  it("says when the server cannot list blocks", async () => {
    routeRequests(requestMock, {
      "query MyBlockedPrincipals": () => {
        throw { response: { errors: [{ message: "Unknown field" }] } };
      },
    });
    renderWithProviders(<BlockedPeople />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your server does not list blocked people yet.",
    );
  });

  it("shows nothing while the relay is off", () => {
    useRelayStore.getState().reset();
    routeRequests(requestMock, {
      "query MyBlockedPrincipals": () => ({ myBlockedPrincipals: [DAVE] }),
    });
    renderWithProviders(<BlockedPeople />);

    expect(screen.queryByRole("heading", { name: "Blocked people" })).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query MyBlockedPrincipals")).toEqual([]);
  });
});
