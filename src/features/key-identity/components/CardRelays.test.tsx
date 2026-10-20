import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  publishProfileCard: vi.fn(),
  profileCardRelays: vi.fn((here: string) => [here]),
}));
vi.mock("../api/keyIdentity", () => api);

const own = vi.hoisted(() => ({
  view: { origin: "http://localhost:8080" as string | null, failed: false },
}));
vi.mock("../../relay/state/serverOrigin", () => ({ useServerOrigin: () => own.view }));

import { relayProblem } from "../../relay/contacts/contactLink";
import { CardRelays } from "./CardRelays";

const identity = { principalId: "rimp1_a" } as MyKeyIdentity;

beforeEach(() => {
  own.view = { origin: "http://localhost:8080", failed: false };
});

describe("CardRelays", () => {
  it("adds a relay after this server and publishes the card with them in order", async () => {
    const user = userEvent.setup();
    const onPublished = vi.fn();
    api.publishProfileCard.mockResolvedValue(undefined);
    render(<CardRelays identity={identity} displayName="Ada" onPublished={onPublished} />);
    expect(screen.getByText("this server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove http:\/\/localhost:8080/i })).toBeDisabled();

    await user.type(screen.getByLabelText("Relay address"), "https://relay.example/");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: /move https:\/\/relay.example up/i }));
    await user.click(screen.getByRole("button", { name: "Publish card" }));
    expect(api.publishProfileCard).toHaveBeenCalledWith(identity, "Ada", [
      "https://relay.example",
      "http://localhost:8080",
    ]);
    expect(onPublished).toHaveBeenCalled();
  });

  it("refuses an address that is not a relay URL", async () => {
    const user = userEvent.setup();
    render(<CardRelays identity={identity} displayName="Ada" onPublished={() => undefined} />);
    await user.type(screen.getByLabelText("Relay address"), "relay.example");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/relay's address/);
    expect(screen.queryByRole("button", { name: "Publish card" })).not.toBeInTheDocument();
  });

  it("lists this server by the origin it is known by, not the page's", () => {
    own.view = { origin: "https://relay.example", failed: false };
    render(<CardRelays identity={identity} displayName="Ada" onPublished={() => undefined} />);
    expect(api.profileCardRelays).toHaveBeenLastCalledWith("https://relay.example", identity);
    expect(screen.getByText("https://relay.example")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove https:\/\/relay.example/i })).toBeDisabled();
  });

  it("waits for this server's origin, and says when it cannot be read", () => {
    own.view = { origin: null, failed: false };
    const { rerender } = render(
      <CardRelays identity={identity} displayName="Ada" onPublished={() => undefined} />,
    );
    expect(screen.getByText(/reading this server's address/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Relay address")).not.toBeInTheDocument();

    own.view = { origin: null, failed: true };
    rerender(<CardRelays identity={identity} displayName="Ada" onPublished={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not read this server's address/i);
    expect(screen.queryByLabelText("Relay address")).not.toBeInTheDocument();
  });

  it("says why a relay cannot be added", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `https://r${i}.example`);
    expect(relayProblem("https://r0.example", eight)).toMatch(/already/);
    expect(relayProblem("https://new.example", eight)).toMatch(/at most 8/);
    expect(relayProblem("https://new.example", [])).toBeNull();
  });
});
