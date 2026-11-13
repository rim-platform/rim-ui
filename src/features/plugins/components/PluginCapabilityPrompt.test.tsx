import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const approve = vi.hoisted(() => vi.fn());
const grant = vi.hoisted(() => vi.fn());
const revoke = vi.hoisted(() => vi.fn());
vi.mock("../api/usePluginCapabilities", () => ({
  useApproveCapabilities: vi.fn(() => ({ mutate: approve, isPending: false })),
  useGrantCommands: vi.fn(() => ({ mutate: grant, isPending: false })),
  useRevokeCapability: vi.fn(() => ({ mutateAsync: revoke, isPending: false })),
}));
const serverCommands = vi.hoisted(() => [
  {
    id: "chat.post_message",
    title: "Post Message",
    description: "",
    category: "Messages",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: "MUTATING",
  },
  {
    id: "chat.delete_message",
    title: "Delete Message",
    description: "",
    category: "Messages",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: true,
    sensitivity: "RESTRICTED",
  },
]);
vi.mock("../../commands/api/useCommands", () => ({
  useCommands: vi.fn(() => ({ data: serverCommands })),
}));
const enable = vi.hoisted(() => vi.fn());
vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: vi.fn(() => ({ mutate: enable, isPending: false })),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/toast", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

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
        "Runs sandboxed in this app. It cannot read your files, run programs, or use your RIM session. It reaches RIM only through the permissions below. Without network access it cannot exchange data with other sites, but what you show it can still be sent out in small amounts, such as by a DNS lookup or by the plugin navigating its frame once, which then stops it. Install a plugin that reads your messages only if you trust its author with them.",
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

  it("gives each chat capability its own line, the encrypted read in the agreed words", () => {
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

  it("starts the encrypted pair unticked and approves only the plain pair by default", () => {
    approve.mockClear();
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={chat} />);
    const [read, readEncrypted, write, writeEncrypted] = screen.getAllByRole("checkbox");
    expect(read).toBeChecked();
    expect(write).toBeChecked();
    expect(readEncrypted).not.toBeChecked();
    expect(writeEncrypted).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(new Set(approve.mock.calls[0][0].capabilities)).toEqual(
      new Set(["chat.read", "chat.write"]),
    );
  });

  it("keeps an encrypted grant ticked when it was approved before", () => {
    render(
      <PluginCapabilityPrompt
        open
        onClose={() => {}}
        plugin={{ ...chat, approved_capabilities: ["chat.read", "chat.read.encrypted"] }}
      />,
    );
    expect(screen.getAllByRole("checkbox")[1]).toBeChecked();
  });

  it("keeps an encrypted grant with its plain one", () => {
    approve.mockClear();
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={chat} />);
    const [read, readEncrypted, write, writeEncrypted] = screen.getAllByRole("checkbox");
    // Ticking the encrypted read keeps the plain read; unticking the plain read clears both.
    fireEvent.click(readEncrypted);
    expect(readEncrypted).toBeChecked();
    fireEvent.click(read);
    expect(read).not.toBeChecked();
    expect(readEncrypted).not.toBeChecked();
    // Ticking the encrypted write after unticking the plain one brings the plain write back.
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

describe("PluginCapabilityPrompt taking permissions back", () => {
  const held = plugin({
    runtime_kind: "WebSandboxed",
    capabilities: ["chat.read", "network.fetch"],
    network_origins: ["https://api.github.com"],
    approved_capabilities: ["chat.read"],
  });

  it("revokes an approved permission the person unticked, then approves the rest", async () => {
    approve.mockReset();
    revoke.mockReset().mockResolvedValue(undefined);
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={held} />);
    const [read, fetchBox] = screen.getAllByRole("checkbox");
    fireEvent.click(read);
    expect(fetchBox).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(revoke).toHaveBeenCalledWith({
      pluginId: "chat.rim.github-prs",
      capability: "chat.read",
    });
    expect(approve.mock.calls[0][0].capabilities).toEqual(["network.fetch"]);
  });

  it("grants nothing when a revocation fails", async () => {
    approve.mockReset();
    revoke.mockReset().mockRejectedValue(new Error("store is locked"));
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={held} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/store is locked/)).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("PluginCapabilityPrompt after an install", () => {
  type Callbacks = { onSuccess?: () => void; onError?: (err: { message: string }) => void };
  const succeed = (_vars: unknown, options: Callbacks) => options.onSuccess?.();

  it("turns the plugin on once its permissions are approved", () => {
    approve.mockReset().mockImplementation(succeed);
    enable.mockReset().mockImplementation(succeed);
    const onClose = vi.fn();
    render(<PluginCapabilityPrompt open onClose={onClose} plugin={plugin({})} startOnApprove />);
    expect(
      screen.getByText(
        "The plugin starts once you approve. Cancel leaves it installed and turned off.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve and turn on" }));
    expect(enable).toHaveBeenCalledWith("chat.rim.github-prs", expect.anything());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says where the panel is when a plugin with a panel turns on", () => {
    approve.mockReset().mockImplementation(succeed);
    enable.mockReset().mockImplementation(succeed);
    toastSuccess.mockClear();
    const withPanel = plugin({
      display_name: "Poll",
      panels: [{ id: "poll", title: "Poll", entry: "panel.html" }] as never,
    });
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={withPanel} startOnApprove />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and turn on" }));
    expect(toastSuccess).toHaveBeenCalledWith("Poll is on. Open it from Plugins in the top bar.");
  });

  it("shows no panel toast for a plugin without a panel", () => {
    approve.mockReset().mockImplementation(succeed);
    enable.mockReset().mockImplementation(succeed);
    toastSuccess.mockClear();
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={plugin({})} startOnApprove />);
    fireEvent.click(screen.getByRole("button", { name: "Approve and turn on" }));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when the plugin does not start", () => {
    approve.mockReset().mockImplementation(succeed);
    enable
      .mockReset()
      .mockImplementation((_id: string, options: Callbacks) =>
        options.onError?.({ message: "the plugin exited" }),
      );
    const onClose = vi.fn();
    render(<PluginCapabilityPrompt open onClose={onClose} plugin={plugin({})} startOnApprove />);

    fireEvent.click(screen.getByRole("button", { name: "Approve and turn on" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The permissions are saved, but the plugin did not start: the plugin exited. Turn it on in Settings > Plugins.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Approve and turn on" })).toBeNull();
    // The footer's Close, beside the dialog's own close control.
    fireEvent.click(screen.getByText("Close", { selector: "button" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("only approves when opened later, or for a plugin already on", () => {
    approve.mockReset().mockImplementation(succeed);
    enable.mockReset();
    const { unmount } = render(
      <PluginCapabilityPrompt open onClose={() => {}} plugin={plugin({})} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    unmount();
    render(
      <PluginCapabilityPrompt
        open
        onClose={() => {}}
        plugin={plugin({ enabled: true })}
        startOnApprove
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(approve).toHaveBeenCalledTimes(2);
    expect(enable).not.toHaveBeenCalled();
  });
});

describe("PluginCapabilityPrompt commands it can run", () => {
  type Callbacks = { onSuccess?: () => void; onError?: (err: { message: string }) => void };
  const succeed = (_vars: unknown, options: Callbacks) => options.onSuccess?.();

  const asking = plugin({
    runs_commands: [
      "workspace.open_home",
      "chat.post_message",
      "chat.delete_message",
      "app.quit",
      "example.unknown",
    ],
    granted_commands: [],
  });

  it("lists each command, nothing checked, and greys those it can't run here", () => {
    render(<PluginCapabilityPrompt open onClose={() => {}} plugin={asking} />);
    const section = screen.getByRole("region", { name: "Commands it can run" });
    expect(section).toBeInTheDocument();
    const home = screen.getByRole("checkbox", { name: "Let it run Open Home" });
    const post = screen.getByRole("checkbox", { name: "Let it run Post Message" });
    expect(home).not.toBeChecked();
    expect(post).not.toBeChecked();
    expect(screen.getByText("asks you each time")).toBeInTheDocument();
    expect(screen.getAllByText("Plugins can't run this")).toHaveLength(2);
    expect(screen.getByText("Not available here")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Delete Message|Quit RIM|example/ })).toBeNull();
  });

  it("grants only the ticked commands after the permissions", () => {
    approve.mockReset().mockImplementation(succeed);
    grant.mockReset().mockImplementation(succeed);
    const onClose = vi.fn();
    render(<PluginCapabilityPrompt open onClose={onClose} plugin={asking} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Let it run Post Message" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(grant).toHaveBeenCalledWith(
      { pluginId: "chat.rim.github-prs", commandIds: ["chat.post_message"] },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("grants nothing when nothing is ticked, and shows granted ones as granted", () => {
    approve.mockReset().mockImplementation(succeed);
    grant.mockReset();
    render(
      <PluginCapabilityPrompt
        open
        onClose={() => {}}
        plugin={{ ...asking, granted_commands: ["workspace.open_home"] }}
      />,
    );
    const home = screen.getByRole("checkbox", { name: "Let it run Open Home" });
    expect(home).toBeChecked();
    expect(home).toBeDisabled();
    expect(screen.getByText("Granted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(grant).not.toHaveBeenCalled();
  });
});
