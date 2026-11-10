import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runner = vi.hoisted(() => ({
  findAgentPrograms: vi.fn(),
  allowAgentProgram: vi.fn(),
  forgetAgentProgram: vi.fn(),
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

import { useAgentProgramsStore, type AgentProgramProfile } from "../state/useAgentProgramsStore";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { AgentProgramsSection, PROGRAMS_NOTE } from "./AgentProgramsSection";

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Claude Code",
  program: "claude-agent-acp",
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
    runner.forgetAgentProgram.mockReset().mockResolvedValue(undefined);
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
          args: ["--acp"],
          defaultFolder: null,
          presetId: "gemini-cli",
        },
        {
          ...PROFILE,
          id: "p3",
          name: "Mine",
          program: "/opt/my agent",
          args: ["a b"],
          presetId: null,
        },
      ],
    });
    render(<AgentProgramsSection />);
    expect(screen.getByText(PROGRAMS_NOTE)).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    await waitFor(() => expect(within(rows[0]).getByText("Not found")).toBeInTheDocument());
    expect(within(rows[0]).getByText("claude-agent-acp")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Starts in /home/a/project")).toBeInTheDocument();
    expect(
      within(rows[0]).getByText("npm install -g @agentclientprotocol/claude-agent-acp"),
    ).toBeInTheDocument();
    expect(
      within(rows[0]).getByRole("button", { name: "Copy install command" }),
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText("Found")).toBeInTheDocument();
    expect(within(rows[1]).getByText("gemini --acp")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No default folder")).toBeInTheDocument();
    expect(within(rows[2]).getByText('"/opt/my agent" "a b"')).toBeInTheDocument();
    expect(within(rows[2]).queryByText(/found/iu)).not.toBeInTheDocument();
    expect(runner.findAgentPrograms).toHaveBeenCalledWith(
      expect.not.arrayContaining(["/opt/my agent"]),
    );
    expect(document.body.textContent).not.toContain(PROFILE.token);
  });

  it("adds a preset that is not found after showing how to install it", async () => {
    const user = userEvent.setup();
    render(<AgentProgramsSection />);
    await waitFor(() => expect(runner.findAgentPrograms).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(await screen.findByRole("menuitem", { name: /Codex/u }));
    const dialog = await screen.findByRole("dialog", { name: "Add Codex" });
    expect(within(dialog).getByText(/codex-acp is not found/u)).toBeInTheDocument();
    expect(
      within(dialog).getByText("npm install -g @agentclientprotocol/codex-acp"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("codex login")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(runner.allowAgentProgram).toHaveBeenCalledWith("codex-acp", []);
    expect(useAgentProgramsStore.getState().profiles).toMatchObject([
      { name: "Codex", program: "codex-acp", presetId: "codex" },
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
      expect(runner.forgetAgentProgram).toHaveBeenCalledWith("claude-agent-acp", []),
    );
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
});
