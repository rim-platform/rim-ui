import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const terminal = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../acp/agentRunner", async () => ({
  ...(await import("../../../test/fakeAcpAgent")).fakeAcpAgent.module(),
  openAgentTerminal: terminal.open,
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: () => Promise.resolve("/home/a") }));
const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("../../../shared/ui/contextMenu/menuActions", () => ({
  copyToClipboard: clipboard.copy,
}));

import { fakeAcpAgent as agent, helloAnswer } from "../../../test/fakeAcpAgent";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";
import {
  AgentSignInDialog,
  FINISH_IN_BROWSER,
  FINISH_IN_TERMINAL,
  NO_SIGN_IN_WAY,
  SIGNED_IN,
} from "./AgentSignInDialog";

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Claude Code",
  program: "/data/agents/claude-code/0.5.1/claude-agent-acp",
  resolvedProgram: "/data/agents/claude-code/0.5.1/claude-agent-acp",
  args: [],
  defaultFolder: null,
  presetId: "claude-code",
  agentId: "a1",
  token: "rimagent_sign-in-token",
  addedAt: "2026-11-10T10:00:00.000Z",
};

function answerWith(authMethods: unknown[]) {
  agent.on("initialize", () => ({ ...helloAnswer(), authMethods }));
}

function renderDialog(profile: AgentProgramProfile = PROFILE, onFinished = vi.fn()) {
  render(<AgentSignInDialog profile={profile} onClose={() => {}} onFinished={onFinished} />);
  return onFinished;
}

describe("AgentSignInDialog", () => {
  beforeEach(() => {
    agent.reset();
    terminal.open.mockReset().mockResolvedValue({ kind: "opened" });
    clipboard.copy.mockReset();
  });

  it("asks the agent in its home folder and opens a terminal method with its arguments", async () => {
    const user = userEvent.setup();
    answerWith([
      {
        id: "claude-ai-login",
        name: "Claude account",
        description: "Log in with your Claude subscription",
        type: "terminal",
        args: ["--cli", "auth", "login", "--claudeai"],
        env: { ACP_LOGIN: "1" },
      },
    ]);
    const onFinished = renderDialog({ ...PROFILE, args: ["--quiet"] });
    const dialog = await screen.findByRole("dialog", { name: "Sign in to Claude Code" });
    expect(await within(dialog).findByText("Claude account")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Log in with your Claude subscription");
    expect(agent.startAgentRun).toHaveBeenCalledWith({
      program: PROFILE.resolvedProgram,
      args: ["--quiet"],
      cwd: "/home/a",
    });
    expect(agent.requests("initialize")[0].params).toMatchObject({
      clientCapabilities: { auth: { terminal: true } },
    });
    await waitFor(() => expect(agent.stopAgentRun).toHaveBeenCalled());
    await user.click(within(dialog).getByRole("button", { name: /Open terminal/u }));
    expect(terminal.open).toHaveBeenCalledWith({
      program: PROFILE.resolvedProgram,
      args: ["--quiet", "--cli", "auth", "login", "--claudeai"],
      env: { ACP_LOGIN: "1" },
    });
    expect(await within(dialog).findByText(FINISH_IN_TERMINAL)).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalled();
    expect(agent.requests("authenticate")).toEqual([]);
    expect(agent.requests("session/new")).toEqual([]);
  });

  it("shows the command to copy when there is no terminal", async () => {
    const user = userEvent.setup();
    answerWith([{ id: "tty", name: "Terminal", type: "terminal", args: ["login"] }]);
    terminal.open.mockResolvedValue({ kind: "noTerminal", commandLine: "claude-agent-acp login" });
    renderDialog({ ...PROFILE, defaultFolder: "/home/a/project" });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Open terminal/u }));
    expect(await within(dialog).findByText("claude-agent-acp login")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Copy the command" }));
    expect(clipboard.copy).toHaveBeenCalledWith("claude-agent-acp login");
    expect(agent.startAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/home/a/project" }),
    );
  });

  it("says nothing more when the terminal is declined", async () => {
    const user = userEvent.setup();
    answerWith([{ id: "tty", name: "Terminal", type: "terminal" }]);
    terminal.open.mockResolvedValue({ kind: "declined" });
    const onFinished = renderDialog();
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Open terminal/u }));
    expect(await within(dialog).findByText("Not opened.")).toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("asks the agent to sign in itself and waits for the browser", async () => {
    const user = userEvent.setup();
    answerWith([{ id: "chatgpt", name: "ChatGPT", description: "Opens your browser" }]);
    let answer: (() => void) | null = null;
    agent.on("authenticate", (_params, id) => {
      answer = () => agent.respond(id, {});
      return undefined;
    });
    const onFinished = renderDialog({ ...PROFILE, name: "Codex", presetId: "codex" });
    const dialog = await screen.findByRole("dialog", { name: "Sign in to Codex" });
    await user.click(await within(dialog).findByRole("button", { name: "Sign in: ChatGPT" }));
    expect(await within(dialog).findByText(FINISH_IN_BROWSER)).toBeInTheDocument();
    expect(agent.requests("authenticate")[0].params).toEqual({ methodId: "chatgpt" });
    expect(agent.stopAgentRun).not.toHaveBeenCalled();
    answer!();
    expect(await within(dialog).findByText(SIGNED_IN)).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalled();
    await waitFor(() => expect(agent.stopAgentRun).toHaveBeenCalled());
  });

  it("shows why signing in failed", async () => {
    const user = userEvent.setup();
    answerWith([{ id: "chatgpt", name: "ChatGPT" }]);
    agent.on("authenticate", (_params, id) => {
      queueMicrotask(() => agent.fail(id, -32603, "Login was cancelled"));
      return undefined;
    });
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Sign in: ChatGPT" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Login was cancelled");
  });

  it("offers each untyped method of Gemini CLI and shows an error on the one that failed", async () => {
    const user = userEvent.setup();
    answerWith([
      { id: "oauth-personal", name: "Log in with Google" },
      { id: "gemini-api-key", name: "Use Gemini API key" },
      { id: "vertex-ai", name: "Vertex AI" },
      { id: "gateway", name: "Gateway" },
    ]);
    agent.on("authenticate", (_params, id) => {
      queueMicrotask(() => agent.fail(id, -32000, "GEMINI_API_KEY is not set"));
      return undefined;
    });
    renderDialog({ ...PROFILE, name: "Gemini CLI", presetId: "gemini-cli" });
    const dialog = await screen.findByRole("dialog");
    const ways = within(await within(dialog).findByRole("list", { name: "Ways to sign in" }));
    expect(ways.getAllByRole("button", { name: /^Sign in: /u })).toHaveLength(4);
    await user.click(ways.getByRole("button", { name: "Sign in: Use Gemini API key" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("GEMINI_API_KEY is not set");
    expect(alert.closest("li")).toHaveTextContent("Use Gemini API key");
    expect(ways.getByRole("button", { name: "Sign in: Log in with Google" })).toBeEnabled();
  });

  it("opens opencode's own terminal method instead of its setup", async () => {
    const user = userEvent.setup();
    answerWith([{ id: "opencode-login", name: "Log in", type: "terminal", args: ["--login"] }]);
    renderDialog({
      ...PROFILE,
      name: "opencode",
      presetId: "opencode",
      program: "/data/agents/opencode/1.0.0/opencode",
      resolvedProgram: "/data/agents/opencode/1.0.0/opencode",
      args: ["acp"],
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Open terminal: Log in" }));
    expect(terminal.open).toHaveBeenCalledWith({
      program: "/data/agents/opencode/1.0.0/opencode",
      args: ["acp", "--login"],
      env: {},
    });
    expect(within(dialog).queryByText(/Set up opencode/u)).not.toBeInTheDocument();
  });

  it("names the variables of an env_var method, with no field to type them in", async () => {
    answerWith([
      { id: "key", name: "API key", type: "env_var", vars: [{ name: "GEMINI_API_KEY" }] },
    ]);
    renderDialog({ ...PROFILE, name: "Gemini CLI", presetId: "gemini-cli" });
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Set GEMINI_API_KEY before starting RIM."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
  });

  it("refuses a terminal method that would change where programs are found", async () => {
    answerWith([
      { id: "tty", name: "Terminal", type: "terminal", env: { PATH: "/tmp/evil", OK: "1" } },
    ]);
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/It would change PATH/u)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Open terminal/u }),
    ).not.toBeInTheDocument();
  });

  it("runs the preset's own setup when the agent names no way", async () => {
    const user = userEvent.setup();
    answerWith([]);
    renderDialog({
      ...PROFILE,
      name: "Goose",
      presetId: "goose",
      program: "goose",
      resolvedProgram: "/usr/bin/goose",
      args: ["acp"],
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", { name: "Open terminal: Set up Goose" }),
    );
    expect(terminal.open).toHaveBeenCalledWith({
      program: "/usr/bin/goose",
      args: ["configure"],
      env: {},
    });
  });

  it("says when the agent names no way and has no setup of its own", async () => {
    answerWith([]);
    renderDialog();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(NO_SIGN_IN_WAY)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Open terminal/u }),
    ).not.toBeInTheDocument();
  });

  it("shows why the agent could not be asked", async () => {
    agent.on("initialize", () => ({ protocolVersion: 2 }));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("version 2");
  });
});
