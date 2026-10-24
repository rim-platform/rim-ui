import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const live = vi.hoisted(() => ({
  beginSwitch: vi.fn(),
  continueSwitch: vi.fn(),
  forgetSwitch: vi.fn(),
  loadSwitch: vi.fn(),
}));
vi.mock("../remote/relaySwitchLive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../remote/relaySwitchLive")>()),
  ...live,
}));
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { username: "ada" } }),
}));

import type { MyKeyIdentity } from "../../key-identity/api/keyIdentity";
import { useRelayStore } from "../state/useRelayStore";
import { RelaySwitchPanel } from "./RelaySwitchPanel";

const identity = { principalId: "rimp1_ada" } as MyKeyIdentity;

describe("RelaySwitchPanel", () => {
  beforeEach(() => {
    Object.values(live).forEach((fn) => fn.mockReset());
    live.loadSwitch.mockResolvedValue(null);
    live.beginSwitch.mockResolvedValue({ step: 0 });
    useRelayStore.setState({
      account: {
        endpoint: "https://old.example/api",
        userId: "u-ada",
        principalId: "rimp1_ada",
        deviceId: "dev-1",
      },
    });
  });

  it("asks for the account password before the switch starts, and passes it on", async () => {
    render(<RelaySwitchPanel identity={identity} displayName="Ada" />);

    await userEvent.type(screen.getByLabelText(/new relay/i), "https://relay.example");
    const start = screen.getByRole("button", { name: "Switch relays" });
    expect(start).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /keep me signed in/i })).toBeChecked();
    await userEvent.type(screen.getByLabelText(/your password/i), "correct horse battery");
    await userEvent.click(start);

    expect(live.continueSwitch).toHaveBeenCalledWith({ step: 0 }, "Ada", {
      password: "correct horse battery",
      keep: true,
    });
  });
});
