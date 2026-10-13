import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { useContactStore } from "../contacts/useContactStore";
import { useRelayStore } from "../state/useRelayStore";

const api = vi.hoisted(() => ({
  fetchContacts: vi.fn(),
  addContact: vi.fn(),
  removeContact: vi.fn(),
}));
const identity = vi.hoisted(() => ({ fetchVerifiedIdentity: vi.fn() }));
vi.mock("../api/relayApi", () => api);
vi.mock("../contacts/identity", () => identity);

import { ContactsSettings } from "./ContactsSettings";

const ME = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
const BOB = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";

function startRelay() {
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "http://localhost:8080/api", userId: "u1", principalId: ME, deviceId: "d1" },
      [],
    );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  useRelayStore.getState().reset();
  useContactStore.setState({ aliases: {} });
  Object.values(api).forEach((fn) => fn.mockReset());
  identity.fetchVerifiedIdentity.mockReset();
});

describe("ContactsSettings", () => {
  it("explains what is needed while the relay is off", () => {
    renderWithProviders(<ContactsSettings />);
    expect(screen.getByText(/need key sign-in/i)).toBeInTheDocument();
  });

  it("shows this account's link and QR code", async () => {
    startRelay();
    api.fetchContacts.mockResolvedValue([]);
    renderWithProviders(<ContactsSettings />);
    expect(screen.getByText(`rim-contact:1:${ME}:http://localhost:8080`)).toBeInTheDocument();
    expect(screen.getByLabelText("Contact QR code")).toBeInTheDocument();
    expect(await screen.findByText("No contacts yet.")).toBeInTheDocument();
  });

  it("adds a contact from a pasted link after showing their verified name", async () => {
    const user = userEvent.setup();
    startRelay();
    api.fetchContacts.mockResolvedValue([]);
    api.addContact.mockResolvedValue({ principalId: BOB, relayUrls: [], addedAt: "" });
    identity.fetchVerifiedIdentity.mockResolvedValue({
      identity: {},
      card: { version: 1, displayName: "Bob", relays: ["https://relay-b.example"] },
    });
    renderWithProviders(<ContactsSettings />);
    await user.click(screen.getByLabelText("Contact link"));
    await user.paste(`rim-contact:1:${BOB}:https://relay-b.example`);
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(identity.fetchVerifiedIdentity).toHaveBeenCalledWith(BOB, ["https://relay-b.example"]);
    await user.type(screen.getByLabelText("Name for this contact"), "Bobby");
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() =>
      expect(api.addContact).toHaveBeenCalledWith(BOB, ["https://relay-b.example"]),
    );
    await waitFor(() => expect(useContactStore.getState().aliases[BOB]).toBe("Bobby"));
  });

  it("refuses a link that is not a contact link", async () => {
    const user = userEvent.setup();
    startRelay();
    api.fetchContacts.mockResolvedValue([]);
    renderWithProviders(<ContactsSettings />);
    await user.click(screen.getByLabelText("Contact link"));
    await user.paste("rim-link:1:abc");
    expect(screen.getByRole("alert")).toHaveTextContent(/not a RIM contact link/);
  });

  it("refuses the viewer's own contact link without asking the server", async () => {
    const user = userEvent.setup();
    startRelay();
    api.fetchContacts.mockResolvedValue([]);
    renderWithProviders(<ContactsSettings />);
    await user.click(screen.getByLabelText("Contact link"));
    await user.paste(`rim-contact:1:${ME}:http://localhost:8080`);
    expect(screen.getByRole("alert")).toHaveTextContent("this is your own contact link");
    expect(screen.queryByRole("button", { name: "Add contact" })).not.toBeInTheDocument();
    expect(identity.fetchVerifiedIdentity).not.toHaveBeenCalled();
  });

  it("shows the server's refusal to add a contact as it gave it", async () => {
    const user = userEvent.setup();
    startRelay();
    api.fetchContacts.mockResolvedValue([]);
    const refusal = "cannot add yourself as a contact";
    // A graphql-request ClientError: its own message embeds the whole response.
    api.addContact.mockRejectedValue(
      Object.assign(new Error(`${refusal}: {"response":{"errors":[]}}`), {
        response: { errors: [{ message: refusal, extensions: { code: "VALIDATION" } }] },
      }),
    );
    identity.fetchVerifiedIdentity.mockResolvedValue({
      identity: {},
      card: { version: 1, displayName: "Bob", relays: [] },
    });
    renderWithProviders(<ContactsSettings />);
    await user.click(screen.getByLabelText("Contact link"));
    await user.paste(`rim-contact:1:${BOB}:https://relay-b.example`);
    await user.click(await screen.findByRole("button", { name: "Add contact" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(new RegExp(`^${refusal}$`));
  });

  it("lists contacts by the name given here, and removes one", async () => {
    const user = userEvent.setup();
    startRelay();
    useContactStore.setState({ aliases: { [BOB]: "Bobby" } });
    api.fetchContacts.mockResolvedValue([
      { principalId: BOB, relayUrls: ["https://relay-b.example"], addedAt: "" },
    ]);
    api.removeContact.mockResolvedValue(undefined);
    identity.fetchVerifiedIdentity.mockResolvedValue({
      identity: {},
      card: { version: 1, displayName: "Bob", relays: [] },
    });
    renderWithProviders(<ContactsSettings />);
    expect(await screen.findByText("Bobby")).toBeInTheDocument();
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeContact).toHaveBeenCalledWith(BOB));
  });
});
