import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MyKeyIdentity } from "../api/keyIdentity";

const api = vi.hoisted(() => ({
  publishProfileCard: vi.fn(),
  profileCardRelays: vi.fn(() => ["http://localhost:8080"]),
}));
vi.mock("../api/keyIdentity", () => api);

import { relayProblem } from "../../relay/contacts/contactLink";
import { CardRelays } from "./CardRelays";

const identity = { principalId: "rimp1_a" } as MyKeyIdentity;

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

  it("says why a relay cannot be added", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `https://r${i}.example`);
    expect(relayProblem("https://r0.example", eight)).toMatch(/already/);
    expect(relayProblem("https://new.example", eight)).toMatch(/at most 8/);
    expect(relayProblem("https://new.example", [])).toBeNull();
  });
});
