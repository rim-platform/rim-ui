import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const approve = vi.hoisted(() => vi.fn());
vi.mock("../api/usePluginCapabilities", () => ({
  useApproveCapabilities: vi.fn(() => ({ mutate: approve, isPending: false })),
}));

import { PluginCapabilityPrompt } from "./PluginCapabilityPrompt";
import type { PluginInfo } from "../types";

function plugin(overrides: Partial<PluginInfo>): PluginInfo {
  return {
    plugin_id: "chat.rim.github-prs",
    manifest_id: "chat.rim.github-prs",
    display_name: "GitHub Pull Requests",
    version: "0.1.0",
    description: "Lists open pull requests.",
    enabled: false,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    ...overrides,
  };
}

describe("PluginCapabilityPrompt consent text", () => {
  it("says a web plugin runs sandboxed, apart from the author's description", () => {
    render(
      <PluginCapabilityPrompt
        open
        onClose={() => {}}
        plugin={plugin({ runtime_kind: "WebSandboxed" })}
      />,
    );
    expect(
      screen.getByText(
        "Runs sandboxed in this app. It cannot read your files, run programs, or use your RIM session. It reaches RIM only through the permissions below.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Runs as a program on this computer/)).toBeNull();
  });

  it("says a local process is not sandboxed, also for hosts that do not report the kind", () => {
    const line =
      "Runs as a program on this computer with your account's access. It is not sandboxed: it can read your files and use the network whatever you approve below. Install it only if you trust its author.";
    const { unmount } = render(
      <PluginCapabilityPrompt
        open
        onClose={() => {}}
        plugin={plugin({ runtime_kind: "DesktopLocalProcess" })}
      />,
    );
    expect(screen.getByText(line)).toBeInTheDocument();
    unmount();
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={plugin({})} />);
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it("names every site network.fetch reaches, without https:// or a default port", () => {
    render(
      <PluginCapabilityPrompt
        open
        onClose={() => {}}
        plugin={plugin({
          runtime_kind: "WebSandboxed",
          capabilities: ["ui.panel", "network.fetch"],
          network_origins: ["https://api.github.com", "https://avatars.githubusercontent.com:443"],
        })}
      />,
    );
    const line = screen.getByText(/^Connect to listed sites:/).closest("p");
    expect(line?.textContent).toBe(
      "Connect to listed sites: send and receive data from api.github.com, avatars.githubusercontent.com. Anything you show this plugin can be sent to these sites.",
    );
  });
});

describe("PluginCapabilityPrompt chat lines", () => {
  const chat = plugin({
    runtime_kind: "WebSandboxed",
    capabilities: ["chat.read", "chat.read.encrypted", "chat.write", "chat.write.encrypted"],
  });

  it("gives each chat capability its own line, the encrypted read in the spec's words", () => {
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={chat} />);
    const line = (start: RegExp) => screen.getByText(start).closest("p")?.textContent;
    expect(line(/^Read your encrypted DMs and groups:/)).toBe(
      "Read your encrypted DMs and groups: this plugin sees their decrypted text and can send it anywhere its other permissions allow.",
    );
    expect(line(/^Post as you in your encrypted DMs and groups:/)).toBe(
      "Post as you in your encrypted DMs and groups: this plugin sends messages in your name there, encrypted like your own.",
    );
    expect(line(/^Read your conversations:/)).toMatch(/except those of encrypted DMs and groups/);
    expect(line(/^Post as you:/)).toMatch(/except in encrypted DMs and groups/);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  });

  it("keeps an encrypted grant with its plain one", () => {
    approve.mockClear();
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={chat} />);
    const [read, readEncrypted, write, writeEncrypted] = screen.getAllByRole("checkbox");
    // Unchecking the plain read unchecks the encrypted read with it.
    fireEvent.click(read);
    expect(readEncrypted).not.toBeChecked();
    // Checking the encrypted write after unchecking both brings the plain write back.
    fireEvent.click(write);
    expect(writeEncrypted).not.toBeChecked();
    fireEvent.click(writeEncrypted);
    expect(write).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(new Set(approve.mock.calls[0][0].capabilities)).toEqual(
      new Set(["chat.write", "chat.write.encrypted"]),
    );
  });
});
