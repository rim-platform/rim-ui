import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { PluginDetailsDialog } from "./PluginDetailsDialog";
import type { PluginInfo } from "../types";

const plugin: PluginInfo = {
  plugin_id: "dev.example.reader",
  manifest_id: "dev.example.reader",
  display_name: "Reader",
  version: "0.1.0",
  description: "Reads.",
  enabled: true,
  capabilities: ["chat.read", "network.fetch"],
  approved_capabilities: ["chat.read"],
  approved_ai_commands: [],
  ai_callable_commands: [],
  ai_consent_required: false,
  fingerprint_changed: false,
};

describe("PluginDetailsDialog", () => {
  it("lists permissions by name with their state", () => {
    render(<PluginDetailsDialog plugin={plugin} onClose={vi.fn()} />);

    const permissions = screen.getByRole("heading", { name: "Permissions" })
      .parentElement as HTMLElement;
    const rows = within(permissions)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual(["Read Chat MessagesGranted", "Connect to listed sitesNot granted"]);
    expect(within(permissions).queryByText("network.fetch")).toBeNull();
  });
});
