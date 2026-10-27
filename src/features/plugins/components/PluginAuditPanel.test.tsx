import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const revoke = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../api/usePluginCapabilities", () => ({
  useRevokeCapability: vi.fn(() => ({ mutateAsync: revoke, isPending: false })),
}));

import { PluginAuditPanel } from "./PluginAuditPanel";
import type { PluginInfo } from "../types";

const plugin: PluginInfo = {
  plugin_id: "dev.example.reader",
  manifest_id: "dev.example.reader",
  display_name: "Reader",
  version: "0.1.0",
  description: "Reads.",
  enabled: true,
  capabilities: ["chat.read", "chat.read.encrypted"],
  approved_capabilities: ["chat.read", "chat.read.encrypted"],
  approved_ai_commands: [],
  ai_callable_commands: [],
  ai_consent_required: false,
  fingerprint_changed: false,
  audit: {
    grants: [
      { capability: "chat.read", action: "granted", at: "2026-10-01T09:00:00Z" },
      { capability: "chat.read.encrypted", action: "granted", at: "2026-10-01T09:00:01Z" },
      { capability: "ui.panel", action: "revoked", at: "2026-10-02T10:00:00Z" },
    ],
    encrypted_reads: { "2026-10-01": 12, "2026-10-03": 1 },
  },
};

describe("PluginAuditPanel", () => {
  it("shows the grant history newest first and the encrypted reads per day", () => {
    render(<PluginAuditPanel plugin={plugin} />);
    const history = screen.getByRole("region", { name: "Permission history" });
    const items = history.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch(/^Render UI Panels revoked/);
    expect(items[2].textContent).toMatch(/^Read Chat Messages granted/);

    const reads = screen.getByRole("region", { name: "Encrypted messages read" });
    const days = [...reads.querySelectorAll("li")].map((li) => li.textContent);
    expect(days).toEqual(["2026-10-031 message", "2026-10-0112 messages"]);
  });

  it("revokes an encrypted grant first when its plain one is revoked", async () => {
    revoke.mockClear();
    render(<PluginAuditPanel plugin={plugin} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke Read Chat Messages" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
    expect(revoke.mock.calls).toEqual([
      [{ pluginId: "dev.example.reader", capability: "chat.read.encrypted" }],
      [{ pluginId: "dev.example.reader", capability: "chat.read" }],
    ]);
    expect(screen.getByText("Revoking a permission stops the plugin.")).toBeInTheDocument();
  });

  it("names permissions as the permission prompt does", () => {
    render(
      <PluginAuditPanel
        plugin={{
          ...plugin,
          approved_capabilities: ["ui.panel", "network.fetch"],
          audit: {
            grants: [
              { capability: "ui.panel", action: "granted", at: "2026-10-01T09:00:00Z" },
              { capability: "network.fetch", action: "granted", at: "2026-10-01T09:00:01Z" },
            ],
            encrypted_reads: {},
          },
        }}
      />,
    );
    const approved = screen.getByRole("region", { name: "Approved permissions" });
    const history = screen.getByRole("region", { name: "Permission history" });
    for (const region of [approved, history]) {
      expect(region).toHaveTextContent("Render UI Panels");
      expect(region).toHaveTextContent("Connect to listed sites");
      expect(region).not.toHaveTextContent("network.fetch");
    }
    expect(
      screen.getByRole("button", { name: "Revoke Connect to listed sites" }),
    ).toBeInTheDocument();
  });

  it("says when nothing was recorded", () => {
    render(
      <PluginAuditPanel plugin={{ ...plugin, approved_capabilities: [], audit: undefined }} />,
    );
    expect(screen.getByText("Nothing recorded yet.")).toBeInTheDocument();
    expect(screen.getAllByText("None.")).toHaveLength(2);
  });
});
