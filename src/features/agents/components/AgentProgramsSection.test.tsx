import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runner = vi.hoisted(() => ({
  findAgentPrograms: vi.fn(),
  allowAgentProgram: vi.fn(),
  forgetAgentProgram: vi.fn(),
  allowedAgentPrograms: vi.fn(),
}));
vi.mock("../acp/agentRunner", () => ({
  DESKTOP_ONLY_MESSAGE: "Starting agents needs the desktop app",
  ...runner,
}));
const platform = vi.hoisted(() => ({ current: "desktop" }));
vi.mock("../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.current,
}));
vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
const installer = vi.hoisted(() => ({
  agentInstallerCatalog: vi.fn(),
  installAgent: vi.fn(),
  removeInstalledAgent: vi.fn(),
  progress: null as ((progress: unknown) => void) | null,
}));
vi.mock("../acp/agentInstaller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../acp/agentInstaller")>()),
  agentInstallerCatalog: installer.agentInstallerCatalog,
  installAgent: installer.installAgent,
  removeInstalledAgent: installer.removeInstalledAgent,
  onInstallProgress: (callback: (progress: unknown) => void) => {
    installer.progress = callback;
    return () => {
      installer.progress = null;
    };
  },
}));
vi.mock("../runtime/pairing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/pairing")>()),
  mintAgent: (name: string) =>
    Promise.resolve({
      agent: {
        id: `agent-${name}`,
        name,
        tokenHash: "h",
        pairedAt: "2026-11-10T10:00:00.000Z",
        grants: {},
        pluginApprovals: {},
        commandApprovals: [],
      },
      token: "rimagent_minted",
    }),
}));
vi.mock("./AgentSignInDialog", () => ({
  AgentSignInDialog: ({ profile }: { profile: { name: string; resolvedProgram: string } }) => (
    <div role="dialog" aria-label={`Sign in to ${profile.name}`}>
      {profile.resolvedProgram}
    </div>
  ),
}));

import { useAgentProgramsStore, type AgentProgramProfile } from "../state/useAgentProgramsStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import type { CatalogEntry } from "../acp/agentInstaller";
import { AgentProgramsSection, PROGRAMS_NOTE } from "./AgentProgramsSection";

const INSTALLED_CLAUDE = {
  presetId: "claude-code",
  version: "0.5.1",
  program: "/data/agents/claude-code/0.5.1/claude-agent-acp",
  args: [],
  installedAt: "2026-11-10T10:00:00.000Z",
};

/** A catalog where everything can be installed and nothing is, but for `changes`. */
function catalog(changes: Record<string, Partial<CatalogEntry>> = {}): CatalogEntry[] {
  return [
    ["claude-code", "Claude Code", "proprietary"],
    ["opencode", "opencode", "MIT"],
    ["goose", "Goose", "Apache-2.0"],
    ["codex", "Codex", "Apache-2.0"],
    ["gemini-cli", "Gemini CLI", "Apache-2.0"],
  ].map(([presetId, name, license]) => ({
    presetId,
    name,
    available: { version: "0.102.0", license, source: `github.com/${presetId}/releases` },
    installed: null,
    problem: null,
    ...changes[presetId],
  }));
}

function supportedRow(name: string): HTMLElement {
  const list = screen.getByRole("list", { name: "Supported agents" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => item.querySelector("span")?.textContent === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

function programRows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Your agent programs" })).getAllByRole("listitem");
}

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Claude Code",
  program: "claude-agent-acp",
  resolvedProgram: "/usr/bin/claude-agent-acp",
  args: [],
  defaultFolder: "/home/a/project",
  presetId: "claude-code",
  agentId: "a1",
  token: "rimagent_section-token",
  addedAt: "2026-11-10T10:00:00.000Z",
};

describe("AgentProgramsSection", () => {
  beforeEach(() => {
    platform.current = "desktop";
    useAgentProgramsStore.setState({ profiles: [] });
    useConnectedAgentsStore.setState({ agents: [] });
    runner.findAgentPrograms
      .mockReset()
      .mockImplementation((names: string[]) =>
        Promise.resolve(names.map((name) => (name === "gemini" ? `/usr/bin/${name}` : null))),
      );
    runner.allowAgentProgram.mockReset().mockResolvedValue(true);
    runner.allowedAgentPrograms.mockReset().mockImplementation(() =>
      Promise.resolve(
        [...new Set(runner.allowAgentProgram.mock.calls.map((call) => JSON.stringify(call)))].map(
          (call) => {
            const [program, args] = JSON.parse(call) as [string, string[]];
            return { program: `/usr/bin/${program}`, args };
          },
        ),
      ),
    );
    runner.forgetAgentProgram.mockReset().mockResolvedValue(undefined);
    installer.agentInstallerCatalog.mockReset().mockResolvedValue(catalog());
    installer.installAgent.mockReset();
    installer.removeInstalledAgent.mockReset().mockResolvedValue(undefined);
  });

  it("says starting agents needs the desktop app on the web", () => {
    platform.current = "web";
    render(<AgentProgramsSection />);
    expect(screen.getByText("Starting agents needs the desktop app")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("lists each program with its command line, folder and whether it is found", async () => {
    useAgentProgramsStore.setState({
      profiles: [
        PROFILE,
        {
          ...PROFILE,
          id: "p2",
          name: "Gemini",
          program: "gemini",
          resolvedProgram: "/usr/bin/gemini",
          args: ["--acp"],
          defaultFolder: null,
          presetId: "gemini-cli",
        },
        {
          ...PROFILE,
          id: "p3",
          name: "Mine",
          program: "/opt/my agent",
          resolvedProgram: "/opt/my agent",
          args: ["a b"],
          presetId: null,
        },
        {
          ...PROFILE,
          id: "p4",
          name: "Old",
          program: "old-agent",
          resolvedProgram: null,
          presetId: null,
        },
      ],
    });
    render(<AgentProgramsSection />);
    expect(screen.getByText(PROGRAMS_NOTE)).toBeInTheDocument();
    const rows = programRows();
    await waitFor(() => expect(within(rows[0]).getByText("Not found")).toBeInTheDocument());
    expect(within(rows[0]).getByText("claude-agent-acp")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Starts in /home/a/project")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Install Claude Code above");
    expect(
      within(rows[0]).queryByRole("button", { name: "Sign in to Claude Code" }),
    ).not.toBeInTheDocument();
    expect(within(rows[1]).getByText("Found")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Sign in to Gemini" })).toBeInTheDocument();
    expect(within(rows[1]).getByText("gemini --acp")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No default folder")).toBeInTheDocument();
    expect(within(rows[2]).getByText('"/opt/my agent" "a b"')).toBeInTheDocument();
    expect(within(rows[2]).queryByText(/found/iu)).not.toBeInTheDocument();
    expect(within(rows[2]).queryByRole("button", { name: /Sign in/u })).not.toBeInTheDocument();
    expect(within(rows[3]).getByText("Not found, add it again")).toBeInTheDocument();
    expect(runner.allowedAgentPrograms).toHaveBeenCalled();
    expect(runner.findAgentPrograms).toHaveBeenCalledWith(
      expect.not.arrayContaining(["/opt/my agent"]),
    );
    expect(document.body.textContent).not.toContain(PROFILE.token);
  });

  it("adds a preset that is not found after pointing at Install", async () => {
    const user = userEvent.setup();
    render(<AgentProgramsSection />);
    await waitFor(() => expect(runner.findAgentPrograms).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(await screen.findByRole("menuitem", { name: /Codex/u }));
    const dialog = await screen.findByRole("dialog", { name: "Add Codex" });
    expect(within(dialog).getByText(/codex-acp is not found/u)).toHaveTextContent(
      "choose Install next to Codex",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(runner.allowAgentProgram).toHaveBeenCalledWith("codex-acp", []);
    expect(useAgentProgramsStore.getState().profiles).toMatchObject([
      {
        name: "Codex",
        program: "codex-acp",
        resolvedProgram: "/usr/bin/codex-acp",
        presetId: "codex",
      },
    ]);
  });

  it("adds a custom program with one argument per line, and keeps the dialog when refused", async () => {
    const user = userEvent.setup();
    runner.allowAgentProgram.mockResolvedValueOnce(false);
    render(<AgentProgramsSection />);
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(await screen.findByRole("menuitem", { name: "Custom…" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a custom agent" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "My agent");
    await user.type(within(dialog).getByRole("textbox", { name: /Program/u }), "my-agent");
    await user.type(
      within(dialog).getByRole("textbox", { name: /Arguments/u }),
      "--acp{Enter}{Enter}--model x",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Not allowed, so nothing was saved.",
    );
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(runner.allowAgentProgram).toHaveBeenLastCalledWith("my-agent", ["--acp", "--model x"]);
  });

  it("removes a program after asking, and disconnects its agent", async () => {
    const user = userEvent.setup();
    useAgentProgramsStore.setState({ profiles: [PROFILE] });
    useConnectedAgentsStore.setState({
      agents: [
        {
          id: "a1",
          name: "Claude Code",
          tokenHash: "h",
          pairedAt: PROFILE.addedAt,
          grants: {},
          pluginApprovals: {},
          commandApprovals: [],
        },
      ],
    });
    render(<AgentProgramsSection />);
    await user.click(screen.getByRole("button", { name: "Remove Claude Code" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Claude Code?" });
    expect(dialog).toHaveTextContent("disconnects the agent it made for it");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    await waitFor(() =>
      expect(runner.forgetAgentProgram).toHaveBeenCalledWith("/usr/bin/claude-agent-acp", []),
    );
  });

  it("says Not found when the lookup finds the program elsewhere than where it was allowed", async () => {
    useAgentProgramsStore.setState({
      profiles: [{ ...PROFILE, program: "gemini", resolvedProgram: "/opt/old/gemini" }],
    });
    render(<AgentProgramsSection />);
    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });

  it("edits a program's name without asking again", async () => {
    const user = userEvent.setup();
    useAgentProgramsStore.setState({ profiles: [PROFILE] });
    render(<AgentProgramsSection />);
    await user.click(screen.getByRole("button", { name: "Edit Claude Code" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Claude Code" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Claude at work");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(runner.allowAgentProgram).not.toHaveBeenCalled();
    expect(useAgentProgramsStore.getState().profiles[0].name).toBe("Claude at work");
  });

  describe("supported agents", () => {
    it("shows each preset's state: install, installed by RIM, found, not available", async () => {
      installer.agentInstallerCatalog.mockResolvedValue(
        catalog({
          "claude-code": {
            installed: INSTALLED_CLAUDE,
            available: { version: "0.6.0", license: "proprietary", source: "github.com/x" },
          },
          goose: { available: null, problem: "Goose has no build for this computer." },
          opencode: { available: null },
        }),
      );
      render(<AgentProgramsSection />);
      await waitFor(() =>
        expect(
          within(supportedRow("Codex")).getByText("0.102.0 · Apache-2.0 licence"),
        ).toBeInTheDocument(),
      );
      const codex = supportedRow("Codex");
      expect(within(codex).getByRole("button", { name: "Install Codex" })).toBeEnabled();
      expect(codex).toHaveTextContent("From github.com/codex/releases");
      const claude = supportedRow("Claude Code");
      expect(within(claude).getByText("Installed by RIM, 0.5.1")).toBeInTheDocument();
      expect(
        within(claude).getByRole("button", { name: "Update Claude Code to 0.6.0" }),
      ).toHaveTextContent("Update to 0.6.0");
      expect(
        within(claude).getByRole("button", { name: "Remove Claude Code's files" }),
      ).toBeInTheDocument();
      expect(within(claude).getByRole("button", { name: "Add Claude Code" })).toBeInTheDocument();
      const gemini = supportedRow("Gemini CLI");
      expect(within(gemini).getByText("Found on this computer")).toBeInTheDocument();
      expect(
        within(gemini).queryByRole("button", { name: "Install Gemini CLI" }),
      ).not.toBeInTheDocument();
      const goose = supportedRow("Goose");
      expect(goose).toHaveTextContent("Not available on this computer");
      expect(goose).toHaveTextContent("Goose has no build for this computer.");
      expect(within(goose).queryByRole("button")).not.toBeInTheDocument();
      expect(supportedRow("opencode")).toHaveTextContent("Not available on this computer");
    });

    it("installs a preset, shows its progress, and adds it without asking the runner", async () => {
      const user = userEvent.setup();
      let finish: (value: unknown) => void = () => {};
      installer.installAgent.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      render(<AgentProgramsSection />);
      const install = await within(supportedRow("Codex")).findByRole("button", {
        name: "Install Codex",
      });
      await user.click(install);
      expect(installer.installAgent).toHaveBeenCalledWith("codex");
      expect(within(supportedRow("Codex")).getByRole("status")).toHaveTextContent("Starting…");
      expect(
        within(supportedRow("Claude Code")).getByRole("button", { name: "Install Claude Code" }),
      ).toBeDisabled();
      act(() =>
        installer.progress?.({ presetId: "codex", stage: "node", received: null, total: null }),
      );
      expect(within(supportedRow("Codex")).getByRole("status")).toHaveTextContent(
        "Downloading Node.js…",
      );
      act(() =>
        installer.progress?.({
          presetId: "codex",
          stage: "downloading",
          received: 34_000_000,
          total: 120_000_000,
        }),
      );
      expect(within(supportedRow("Codex")).getByRole("status")).toHaveTextContent(
        "Downloading… 34 of 120 MB",
      );
      act(() =>
        installer.progress?.({ presetId: "codex", stage: "checking", received: null, total: null }),
      );
      expect(within(supportedRow("Codex")).getByRole("status")).toHaveTextContent("Checking…");
      const program = "/data/agents/codex/0.102.0/codex-acp";
      installer.agentInstallerCatalog.mockResolvedValue(
        catalog({
          codex: {
            installed: {
              presetId: "codex",
              version: "0.102.0",
              program,
              args: [],
              installedAt: "2026-11-10T10:00:00.000Z",
            },
          },
        }),
      );
      await act(async () => {
        finish({
          kind: "installed",
          agent: { presetId: "codex", version: "0.102.0", program, args: [], installedAt: "" },
          replacedProgram: null,
        });
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(useAgentProgramsStore.getState().profiles).toMatchObject([
          { name: "Codex", program, resolvedProgram: program, args: [], presetId: "codex" },
        ]),
      );
      expect(runner.allowAgentProgram).not.toHaveBeenCalled();
      expect(useConnectedAgentsStore.getState().agents).toHaveLength(1);
      const row = supportedRow("Codex");
      expect(await within(row).findByText("Installed by RIM, 0.102.0")).toBeInTheDocument();
      expect(row).toHaveTextContent("Codex is installed. Sign in once so it can work.");
      await user.click(within(row).getByRole("button", { name: "Sign in to Codex" }));
      expect(await screen.findByRole("dialog", { name: "Sign in to Codex" })).toHaveTextContent(
        program,
      );
      expect(programRows()[0]).toHaveTextContent("Installed by RIM");
    });

    it("updates an installed agent by moving its profile to the new program", async () => {
      const user = userEvent.setup();
      const old = INSTALLED_CLAUDE.program;
      const next = "/data/agents/claude-code/0.6.0/claude-agent-acp";
      useAgentProgramsStore.setState({
        profiles: [{ ...PROFILE, program: old, resolvedProgram: old }],
      });
      installer.agentInstallerCatalog.mockResolvedValue(
        catalog({
          "claude-code": {
            installed: INSTALLED_CLAUDE,
            available: { version: "0.6.0", license: "proprietary", source: "github.com/x" },
          },
        }),
      );
      installer.installAgent.mockResolvedValue({
        kind: "installed",
        agent: { ...INSTALLED_CLAUDE, version: "0.6.0", program: next },
        replacedProgram: old,
      });
      render(<AgentProgramsSection />);
      await user.click(
        await within(supportedRow("Claude Code")).findByRole("button", {
          name: "Update Claude Code to 0.6.0",
        }),
      );
      await waitFor(() =>
        expect(useAgentProgramsStore.getState().profiles).toEqual([
          { ...PROFILE, program: next, resolvedProgram: next },
        ]),
      );
      expect(runner.allowAgentProgram).not.toHaveBeenCalled();
      expect(runner.forgetAgentProgram).not.toHaveBeenCalled();
      expect(supportedRow("Claude Code")).not.toHaveTextContent("Sign in once");
    });

    it("does nothing when the install is declined in the system dialog", async () => {
      const user = userEvent.setup();
      installer.installAgent.mockResolvedValue({ kind: "declined" });
      render(<AgentProgramsSection />);
      await user.click(
        await within(supportedRow("Goose")).findByRole("button", { name: "Install Goose" }),
      );
      await waitFor(() =>
        expect(
          within(supportedRow("Goose")).getByRole("button", { name: "Install Goose" }),
        ).toBeEnabled(),
      );
      expect(useAgentProgramsStore.getState().profiles).toEqual([]);
      expect(within(supportedRow("Goose")).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows why an install failed", async () => {
      const user = userEvent.setup();
      installer.installAgent.mockRejectedValue(new Error("The download's checksum didn't match."));
      render(<AgentProgramsSection />);
      await user.click(
        await within(supportedRow("Goose")).findByRole("button", { name: "Install Goose" }),
      );
      expect(await within(supportedRow("Goose")).findByRole("alert")).toHaveTextContent(
        "The download's checksum didn't match.",
      );
      expect(useAgentProgramsStore.getState().profiles).toEqual([]);
    });

    it("says when the catalog can't be read, and keeps a found agent", async () => {
      installer.agentInstallerCatalog.mockRejectedValue(new Error("No connection."));
      render(<AgentProgramsSection />);
      expect(await screen.findByText("No connection.")).toHaveAttribute("role", "alert");
      expect(supportedRow("Gemini CLI")).toHaveTextContent("Found on this computer");
      expect(supportedRow("Codex")).toHaveTextContent("Not available on this computer");
    });

    it("removes an installed agent's files after asking, with the profile that starts it", async () => {
      const user = userEvent.setup();
      const program = INSTALLED_CLAUDE.program;
      useAgentProgramsStore.setState({
        profiles: [{ ...PROFILE, program, resolvedProgram: program }],
      });
      useConnectedAgentsStore.setState({
        agents: [
          {
            id: "a1",
            name: "Claude Code",
            tokenHash: "h",
            pairedAt: PROFILE.addedAt,
            grants: {},
            pluginApprovals: {},
            commandApprovals: [],
          },
        ],
      });
      installer.agentInstallerCatalog.mockResolvedValue(
        catalog({ "claude-code": { installed: INSTALLED_CLAUDE } }),
      );
      render(<AgentProgramsSection />);
      await user.click(
        await within(supportedRow("Claude Code")).findByRole("button", {
          name: "Remove Claude Code's files",
        }),
      );
      const dialog = await screen.findByRole("dialog", {
        name: "Remove Claude Code's files from this computer?",
      });
      expect(dialog).toHaveTextContent("Its sessions stop working until you install it again.");
      installer.agentInstallerCatalog.mockResolvedValue(catalog());
      await user.click(within(dialog).getByRole("button", { name: "Remove files" }));
      await waitFor(() => expect(useAgentProgramsStore.getState().profiles).toEqual([]));
      expect(installer.removeInstalledAgent).toHaveBeenCalledWith("claude-code");
      expect(useConnectedAgentsStore.getState().agents).toEqual([]);
      expect(
        await within(supportedRow("Claude Code")).findByRole("button", {
          name: "Install Claude Code",
        }),
      ).toBeInTheDocument();
    });

    it("keeps the profile and says why when the installer refuses to remove", async () => {
      const user = userEvent.setup();
      const program = INSTALLED_CLAUDE.program;
      useAgentProgramsStore.setState({
        profiles: [{ ...PROFILE, program, resolvedProgram: program }],
      });
      installer.agentInstallerCatalog.mockResolvedValue(
        catalog({ "claude-code": { installed: INSTALLED_CLAUDE } }),
      );
      installer.removeInstalledAgent.mockRejectedValue(new Error("Stop its sessions first."));
      render(<AgentProgramsSection />);
      await user.click(
        await within(supportedRow("Claude Code")).findByRole("button", {
          name: "Remove Claude Code's files",
        }),
      );
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove files" }),
      );
      expect(await within(supportedRow("Claude Code")).findByRole("alert")).toHaveTextContent(
        "Stop its sessions first.",
      );
      expect(useAgentProgramsStore.getState().profiles).toHaveLength(1);
    });
  });
});
