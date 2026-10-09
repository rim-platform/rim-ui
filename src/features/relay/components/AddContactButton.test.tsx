import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { useRelayStore } from "../state/useRelayStore";

const api = vi.hoisted(() => ({
  fetchContacts: vi.fn(),
  addContact: vi.fn(),
  removeContact: vi.fn(),
}));
const identity = vi.hoisted(() => ({ resolveIdentity: vi.fn(), fetchVerifiedIdentity: vi.fn() }));
vi.mock("../api/relayApi", () => api);
vi.mock("../contacts/identity", () => identity);

import { AddContactButton } from "./AddContactButton";

beforeEach(() => {
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
  Object.values(api).forEach((fn) => fn.mockReset());
  identity.resolveIdentity.mockReset();
});

describe("AddContactButton", () => {
  it("adds a workspace member with the relays of their verified card", async () => {
    const user = userEvent.setup();
    api.fetchContacts.mockResolvedValue([]);
    api.addContact.mockResolvedValue({});
    identity.resolveIdentity.mockResolvedValue({
      identity: {},
      card: { version: 2, displayName: "Bob", relays: ["https://relay-b.example"] },
    });
    renderWithProviders(<AddContactButton principalId="rimp1_bob" name="Bob" />);
    await user.click(await screen.findByRole("button", { name: "Add Bob as contact" }));
    await waitFor(() =>
      expect(api.addContact).toHaveBeenCalledWith("rimp1_bob", ["https://relay-b.example"]),
    );
  });

  it("is not offered for this person, a contact, or someone without a principal", async () => {
    api.fetchContacts.mockResolvedValue([{ principalId: "rimp1_bob", relayUrls: [], addedAt: "" }]);
    renderWithProviders(
      <>
        <AddContactButton principalId="rimp1_me" name="Me" />
        <AddContactButton principalId="rimp1_bob" name="Bob" />
        <AddContactButton principalId={null} name="Bot" />
        <AddContactButton principalId="rimp1_carol" name="Carol" />
      </>,
    );
    expect(await screen.findByRole("button", { name: "Add Carol as contact" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
