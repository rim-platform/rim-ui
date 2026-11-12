import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runner = vi.hoisted(() => ({ findAgentPrograms: vi.fn(), pickAgentFolder: vi.fn() }));
vi.mock("../../acp/agentRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../acp/agentRunner")>()),
  ...(await import("../../../../test/fakeAcpAgent")).fakeAcpAgent.module(),
  findAgentPrograms: runner.findAgentPrograms,
  pickAgentFolder: runner.pickAgentFolder,
}));
const platform = vi.hoisted(() => ({ current: "desktop" }));
vi.mock("../../../../core/runtime/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/runtime/runtime")>()),
  detectPlatform: () => platform.current,
}));
vi.mock("../../../notifications/runtime/desktopNotification", () => ({
  showDesktopNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../AgentSignInDialog", () => ({
  AgentSignInDialog: ({
    profile,
    onClose,
    onFinished,
  }: {
    profile: { name: string };
    onClose: () => void;
    onFinished?: () => void;
  }) => (
    <div role="dialog" aria-label={`Sign in to ${profile.name}`}>
      <button type="button" onClick={() => onFinished?.()}>
        Signed in
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

import { useShellStore } from "../../../../shell/state/useShellStore";
import { fakeAcpAgent as agent, helloAnswer } from "../../../../test/fakeAcpAgent";
import type { AgentBridgeStatus } from "../../api/agentBridge";
import { useAgentProgramsStore, type AgentProgramProfile } from "../../state/useAgentProgramsStore";
import {
  agentSessionOf,
  setAgentSessionDepsForTests,
  stopAllAgentSessions,
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
} from "../../state/useAgentSessionsStore";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { AgentSessionPage } from "./AgentSessionPage";
import { AgentSessionsPage } from "./AgentSessionsPage";
import {
  ADD_PROGRAM_FIRST,
  agentCannotSentence,
  bridgeOffSentence,
  FOLDER_NEEDED,
  sandboxSentence,
} from "./sessionText";
import { StartAgentSessionDialogHost } from "./StartAgentSessionDialog";

const PROFILE: AgentProgramProfile = {
  id: "p1",
  name: "Fake Agent",
  program: "fake-agent",
  resolvedProgram: "/usr/bin/fake-agent",
  args: ["acp"],
  defaultFolder: "/home/a/project",
  presetId: null,
  agentId: "a1",
  token: "rimagent_screens-token-0123456789abcdefghijklmnopqr",
  addedAt: "2026-11-10T10:00:00.000Z",
};

const MISSING: AgentProgramProfile = {
  ...PROFILE,
  id: "p2",
  name: "Missing Agent",
  program: "missing-agent",
  resolvedProgram: "/usr/bin/missing-agent",
};

const BRIDGE_ON: AgentBridgeStatus = { enabled: true, listening: true, error: null, port: 47821 };

/** The main surface as the app shell shows it, with the start dialog. */
function Shell() {
  const surface = useShellStore((s) => s.mainSurface);
  return (
    <>
      {surface.kind === "agent-sessions" && <AgentSessionsPage />}
      {surface.kind === "agent-session" && (
        <AgentSessionPage key={surface.key} sessionKey={surface.key} />
      )}
      <StartAgentSessionDialogHost />
    </>
  );
}

function bridge(status: AgentBridgeStatus) {
  setAgentSessionDepsForTests({ bridgeStatus: () => Promise.resolve(status) });
}

/** Sends a prompt request's id to `held`, leaving the turn open. */
function holdPrompt(held: { id: number }) {
  agent.on("session/prompt", (_params, id) => {
    held.id = id;
    return undefined;
  });
}

/** Starts a session from the list's empty state and waits until it is ready. */
async function startFromDialog(user: ReturnType<typeof userEvent.setup>) {
  useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
  render(<Shell />);
  await user.click(screen.getByRole("button", { name: "Start a session" }));
  const dialog = await screen.findByRole("dialog", { name: "Start an agent session" });
  await user.click(within(dialog).getByRole("button", { name: "Start" }));
  const composer = await screen.findByRole("textbox", { name: "Prompt for Fake Agent" });
  await waitFor(() => expect(composer).toBeEnabled());
  return composer;
}

function prompts() {
  return agent.requests("session/prompt").map((request) => (request.params as never)["prompt"]);
}

describe("agent session screens", () => {
  beforeEach(() => {
    platform.current = "desktop";
    agent.reset();
    agent
      .on("initialize", () => helloAnswer())
      .on("session/new", () => ({ sessionId: "sess_1" }))
      .on("session/cancel", () => undefined)
      .on("session/load", () => ({}));
    bridge(BRIDGE_ON);
    runner.findAgentPrograms.mockImplementation((names: string[]) =>
      Promise.resolve(names.map((name) => (name === "fake-agent" ? "/usr/bin/fake-agent" : null))),
    );
    useAgentProgramsStore.setState({ profiles: [PROFILE] });
  });

  afterEach(async () => {
    await act(() => stopAllAgentSessions());
    useAgentSessionsStore.setState({ recent: [] });
    useAgentProgramsStore.setState({ profiles: [] });
    useStartAgentSessionStore.getState().close();
    useShellStore.getState().reset();
    setAgentSessionDepsForTests({});
    vi.clearAllMocks();
  });

  describe("the list", () => {
    it("asks for an agent program first when there is none", async () => {
      useAgentProgramsStore.setState({ profiles: [] });
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      expect(screen.getByText("No agent sessions yet.")).toBeInTheDocument();
      expect(screen.getByText(ADD_PROGRAM_FIRST)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Open Settings → Agents" }));
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agents" });
    });

    it("says starting agents needs the desktop app on the web", () => {
      platform.current = "web";
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      render(<Shell />);
      expect(screen.getByText("Starting agents needs the desktop app.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start a session" })).toBeNull();
    });

    it("groups running and recent sessions, with the folder's full path on focus", async () => {
      useAgentSessionsStore.getState().upsert({
        key: "old",
        profileId: "p1",
        agentName: "Fake Agent",
        cwd: "/home/a/older",
        acpSessionId: "acp-old",
        title: "Earlier work",
        startedAt: "2026-11-09T10:00:00.000Z",
        lastActivityAt: "2026-11-09T11:00:00.000Z",
        canReopen: true,
      });
      const user = userEvent.setup();
      await startFromDialog(user);
      act(() => useShellStore.getState().setMainSurface({ kind: "agent-sessions" }));
      const running = screen.getByRole("region", { name: "Running" });
      expect(within(running).getByText("Ready")).toBeInTheDocument();
      expect(within(running).getByText("project")).toBeInTheDocument();
      const recent = screen.getByRole("region", { name: "Recent" });
      expect(within(recent).getByText("Earlier work")).toBeInTheDocument();
      const folder = within(recent).getByLabelText("Folder /home/a/older");
      act(() => folder.focus());
      expect(await screen.findByRole("tooltip")).toHaveTextContent("/home/a/older");
    });
  });

  describe("starting", () => {
    it("starts a session in the folder from the dialog and focuses the composer", async () => {
      useAgentProgramsStore.setState({ profiles: [PROFILE, MISSING] });
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Start a session" }));
      const dialog = await screen.findByRole("dialog", { name: "Start an agent session" });
      await waitFor(() =>
        expect(within(dialog).getByRole("radio", { name: /Missing Agent/u })).toBeDisabled(),
      );
      expect(
        within(dialog).getByText("missing-agent is not found on this computer."),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("radio", { name: /Fake Agent/u })).toBeChecked();
      const folder = within(dialog).getByRole("textbox");
      expect(folder).toHaveValue("/home/a/project");
      expect(within(dialog).getByText(sandboxSentence("/home/a/project"))).toBeInTheDocument();

      await user.clear(folder);
      await user.type(folder, "relative/path");
      await user.click(within(dialog).getByRole("button", { name: "Start" }));
      expect(within(dialog).getByRole("alert")).toHaveTextContent(FOLDER_NEEDED);
      expect(agent.startAgentRun).not.toHaveBeenCalled();

      await user.clear(folder);
      await user.type(folder, "/home/a/other");
      await user.click(within(dialog).getByRole("button", { name: "Start" }));
      const composer = await screen.findByRole("textbox", { name: "Prompt for Fake Agent" });
      await waitFor(() => expect(composer).toHaveFocus());
      expect(agent.startAgentRun).toHaveBeenCalledWith({
        program: "/usr/bin/fake-agent",
        args: ["acp"],
        cwd: "/home/a/other",
      });
      expect(screen.getByText(sandboxSentence("/home/a/other"))).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("fills the folder from the system's folder dialog, which opens at the folder written", async () => {
      runner.pickAgentFolder.mockResolvedValueOnce("/home/a/picked").mockResolvedValueOnce(null);
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Start a session" }));
      const dialog = await screen.findByRole("dialog", { name: "Start an agent session" });
      const folder = within(dialog).getByRole("textbox", { name: "Folder" });
      await user.click(within(dialog).getByRole("button", { name: "Browse for the folder" }));
      expect(runner.pickAgentFolder).toHaveBeenCalledWith("/home/a/project");
      await waitFor(() => expect(folder).toHaveValue("/home/a/picked"));
      await user.click(within(dialog).getByRole("button", { name: "Browse for the folder" }));
      await waitFor(() => expect(runner.pickAgentFolder).toHaveBeenCalledTimes(2));
      expect(folder).toHaveValue("/home/a/picked");
      await user.click(within(dialog).getByRole("button", { name: "Start" }));
      await waitFor(() =>
        expect(agent.startAgentRun).toHaveBeenCalledWith({
          program: "/usr/bin/fake-agent",
          args: ["acp"],
          cwd: "/home/a/picked",
        }),
      );
    });

    it("says when the folder dialog could not open, and typing still works", async () => {
      runner.pickAgentFolder.mockRejectedValueOnce(new Error("The folder dialog did not open."));
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Start a session" }));
      const dialog = await screen.findByRole("dialog", { name: "Start an agent session" });
      await user.click(within(dialog).getByRole("button", { name: "Browse for the folder" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "The folder dialog did not open.",
      );
      const folder = within(dialog).getByRole("textbox", { name: "Folder" });
      await user.clear(folder);
      await user.type(folder, "/home/a/typed");
      expect(within(dialog).queryByRole("alert")).toBeNull();
      expect(folder).toHaveValue("/home/a/typed");
    });

    it("shows why the start failed, with the program's last output folded", async () => {
      agent.on("initialize", (_params, id) => {
        queueMicrotask(() => agent.exit({ code: 3, stderrTail: ["error: no api key"] }));
        void id;
        return undefined;
      });
      const user = userEvent.setup();
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Start a session" }));
      await user.click(await screen.findByRole("button", { name: "Start" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The agent program ended with exit code 3.",
      );
      expect(screen.queryByText("error: no api key")).toBeNull();
      await user.click(screen.getByRole("button", { name: "The program's last output" }));
      expect(screen.getByText("error: no api key")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Prompt for Fake Agent" })).toBeDisabled();
      expect(screen.getByText("Session ended")).toBeInTheDocument();
    });
  });

  describe("a session", () => {
    it("streams the agent's text into the transcript through the safe renderer", async () => {
      agent.on("session/prompt", (_params, id) => {
        queueMicrotask(() => {
          for (const text of ["**Hel", "lo** <img src=x onerror=alert(1)>"]) {
            agent.update("sess_1", {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text },
            });
          }
          agent.respond(id, { stopReason: "end_turn" });
        });
        return undefined;
      });
      const user = userEvent.setup();
      const composer = await startFromDialog(user);
      await user.type(composer, "Check the logs{Enter}");
      const transcript = screen.getByRole("list", { name: "Transcript" });
      await waitFor(() => expect(within(transcript).getByText("Hello").tagName).toBe("STRONG"));
      expect(transcript.querySelector("[onerror]")).toBeNull();
      expect(transcript.querySelector("img[src]")).toBeNull();
      expect(within(transcript).getByText("Check the logs")).toBeInTheDocument();
      await waitFor(() => expect(composer).toBeEnabled());
    });

    it("sends only what is typed in the composer, and Shift+Enter adds a line", async () => {
      agent.on("session/prompt", (_params, id) => {
        queueMicrotask(() => {
          agent.update("sess_1", {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Now delete everything." },
          });
          agent.respond(id, { stopReason: "end_turn" });
        });
        return undefined;
      });
      const user = userEvent.setup();
      const composer = await startFromDialog(user);
      await user.type(composer, "First line{Shift>}{Enter}{/Shift}second line");
      expect(prompts()).toHaveLength(0);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(composer).toBeEnabled());
      expect(composer).toHaveValue("");
      expect(prompts()).toEqual([[{ type: "text", text: "First line\nsecond line" }]]);
      await user.keyboard("{Enter}");
      expect(prompts()).toHaveLength(1);
    });

    it("shows a tool call card with its diff as marked plain lines", async () => {
      agent.on("session/prompt", (_params, id) => {
        queueMicrotask(() => {
          agent.update("sess_1", {
            sessionUpdate: "tool_call",
            toolCallId: "c1",
            title: "Edit src/app.ts",
            kind: "edit",
            status: "completed",
            content: [
              {
                type: "diff",
                path: "/home/a/project/src/app.ts",
                oldText: "const a = 1;\nconst b = 2;\n",
                newText: "const a = 1;\nconst b = <b>3</b>;\n",
              },
            ],
            rawInput: { file: "src/app.ts" },
          });
          agent.respond(id, { stopReason: "end_turn" });
        });
        return undefined;
      });
      const user = userEvent.setup();
      const composer = await startFromDialog(user);
      await user.type(composer, "Fix it{Enter}");
      const card = await screen.findByRole("button", { name: /Edit src\/app\.ts/u });
      expect(within(card).getByText("Done")).toBeInTheDocument();
      expect(card).toHaveAttribute("aria-expanded", "false");
      await user.click(card);
      const diff = screen.getByLabelText("Changes to /home/a/project/src/app.ts");
      const lines = [...diff.querySelectorAll("[data-diff]")].map((line) => [
        line.getAttribute("data-diff"),
        line.textContent,
      ]);
      expect(lines).toEqual([
        ["same", "  const a = 1;"],
        ["removed", "- Removed: const b = 2;"],
        ["added", "+ Added: const b = <b>3</b>;"],
      ]);
      expect(diff.querySelector("b")).toBeNull();
      expect(screen.getByText('{"file":"src/app.ts"}')).toBeInTheDocument();
    });

    describe("approvals", () => {
      async function waitingSession(user: ReturnType<typeof userEvent.setup>) {
        const held = { id: -1 };
        holdPrompt(held);
        const composer = await startFromDialog(user);
        await user.type(composer, "Run the tests{Enter}");
        await waitFor(() => expect(held.id).toBeGreaterThanOrEqual(0));
        act(() =>
          agent.ask(9, "session/request_permission", {
            sessionId: "sess_1",
            toolCall: {
              toolCallId: "c2",
              title: "Run npm test",
              kind: "execute",
              rawInput: { command: "npm test" },
            },
            options: [
              { optionId: "allow", name: "Allow once", kind: "allow_once" },
              { optionId: "always", name: "Always allow", kind: "allow_always" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          }),
        );
        const card = await screen.findByRole("group", {
          name: "Fake Agent wants to: Run npm test",
        });
        return { card, held, composer };
      }

      function answer() {
        return agent.received.find((message) => message.id === 9)?.result;
      }

      it("shows the request with one button per option, focused, and sends Allow", async () => {
        const user = userEvent.setup();
        const { card, composer } = await waitingSession(user);
        await waitFor(() => expect(card).toHaveFocus());
        expect(within(card).getByText("Run")).toBeInTheDocument();
        expect(within(card).getByText('{"command":"npm test"}')).toBeInTheDocument();
        expect(
          within(card)
            .getAllByRole("button")
            .map((button) => button.textContent),
        ).toEqual(["Allow once", "Always allow", "Reject"]);
        expect(composer).toBeDisabled();
        expect(screen.getByText("Waiting for your answer above")).toBeInTheDocument();
        await user.click(within(card).getByRole("button", { name: "Allow once" }));
        await waitFor(() =>
          expect(answer()).toEqual({ outcome: { outcome: "selected", optionId: "allow" } }),
        );
        expect(screen.queryByRole("group", { name: /wants to/u })).toBeNull();
      });

      it("sends Reject", async () => {
        const user = userEvent.setup();
        const { card } = await waitingSession(user);
        await user.click(within(card).getByRole("button", { name: "Reject" }));
        await waitFor(() =>
          expect(answer()).toEqual({ outcome: { outcome: "selected", optionId: "reject" } }),
        );
      });

      it("answers cancelled when the person cancels the turn", async () => {
        const user = userEvent.setup();
        const { held } = await waitingSession(user);
        await user.click(screen.getByRole("button", { name: "Cancel turn" }));
        await waitFor(() => expect(answer()).toEqual({ outcome: { outcome: "cancelled" } }));
        expect(agent.requests("session/cancel")).toHaveLength(1);
        expect(screen.queryByRole("group", { name: /wants to/u })).toBeNull();
        act(() => agent.respond(held.id, { stopReason: "cancelled" }));
        expect(await screen.findByText("Stopped.")).toBeInTheDocument();
      });
    });

    it("stops at once when no turn runs, and asks first while one does", async () => {
      const user = userEvent.setup();
      const held = { id: -1 };
      holdPrompt(held);
      const composer = await startFromDialog(user);
      await user.type(composer, "Work{Enter}");
      await screen.findByRole("button", { name: "Cancel turn" });
      await user.click(screen.getByRole("button", { name: "Stop" }));
      const confirm = await screen.findByRole("dialog", { name: "Stop Fake Agent?" });
      await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
      expect(agent.stopAgentRun).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Stop" }));
      await user.click(
        within(await screen.findByRole("dialog", { name: "Stop Fake Agent?" })).getByRole(
          "button",
          { name: "Stop" },
        ),
      );
      await waitFor(() => expect(agent.stopAgentRun).toHaveBeenCalledTimes(1));
      expect(await screen.findByText("Session ended")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });

    it("stops a ready session without asking", async () => {
      const user = userEvent.setup();
      await startFromDialog(user);
      await user.click(screen.getByRole("button", { name: "Stop" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(agent.stopAgentRun).toHaveBeenCalledTimes(1));
    });

    describe("the agent's settings", () => {
      const option = (id: string, name: string, category: string, current: string) => ({
        id,
        name,
        category,
        type: "select",
        currentValue: current,
        options: [
          { value: `${id}-a`, name: `${name} A` },
          { value: `${id}-b`, name: `${name} B` },
        ],
      });

      beforeEach(() => {
        agent
          .on("session/new", () => ({
            sessionId: "sess_1",
            modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }] },
            configOptions: [
              option("mode", "Mode", "mode", "mode-a"),
              option("model", "Model", "model", "model-a"),
            ],
          }))
          .on("session/set_config_option", () => ({
            configOptions: [
              option("mode", "Mode", "mode", "mode-a"),
              option("model", "Model", "model", "model-b"),
              option("effort", "Effort", "thought_level", "effort-a"),
            ],
          }));
      });

      it("shows a select per config option, the model first, instead of the modes", async () => {
        const user = userEvent.setup();
        await startFromDialog(user);
        const settings = screen.getByRole("group", { name: "Fake Agent's settings" });
        const selects = within(settings).getAllByRole("combobox");
        expect(selects.map((select) => select.closest("label")?.firstChild?.textContent)).toEqual([
          "Model",
          "Mode",
        ]);
        expect(within(settings).getByRole("combobox", { name: "Mode" })).toHaveValue("mode-a");
        expect(within(settings).queryByRole("option", { name: "Ask" })).toBeNull();

        await user.selectOptions(
          within(settings).getByRole("combobox", { name: "Model" }),
          "model-b",
        );
        await waitFor(() =>
          expect(agent.requests("session/set_config_option")[0]?.params).toEqual({
            sessionId: "sess_1",
            configId: "model",
            value: "model-b",
          }),
        );
        expect(await within(settings).findByRole("combobox", { name: "Effort" })).toHaveValue(
          "effort-a",
        );
        expect(within(settings).getByRole("combobox", { name: "Model" })).toHaveValue("model-b");
        expect(useAgentProgramsStore.getState().profiles[0].preferredModel).toEqual({
          configId: "model",
          value: "model-b",
        });
      });

      it("shows in the session when the agent refuses a setting", async () => {
        agent.on("session/set_config_option", (_params, id) => {
          queueMicrotask(() => agent.fail(id, -32603, "Rate limited"));
          return undefined;
        });
        const user = userEvent.setup();
        await startFromDialog(user);
        await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "model-b");
        expect(await screen.findByText("Model did not change: Rate limited")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("model-a");
      });

      it("turns the settings off while a turn runs", async () => {
        const held = { id: 0 };
        holdPrompt(held);
        const user = userEvent.setup();
        const composer = await startFromDialog(user);
        expect(screen.getByRole("combobox", { name: "Model" })).toBeEnabled();
        await user.type(composer, "Go{Enter}");
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled());
        act(() => agent.respond(held.id, { stopReason: "end_turn" }));
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toBeEnabled());
      });

      it("offers the older model list of an agent without config options", async () => {
        agent
          .on("session/new", () => ({
            sessionId: "sess_1",
            models: {
              currentModelId: "m1",
              availableModels: [
                { modelId: "m1", name: "One" },
                { modelId: "m2", name: "Two" },
              ],
            },
          }))
          .on("session/set_model", () => ({}));
        const user = userEvent.setup();
        await startFromDialog(user);
        await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "m2");
        await waitFor(() =>
          expect(agent.requests("session/set_model")[0]?.params).toEqual({
            sessionId: "sess_1",
            modelId: "m2",
          }),
        );
        await waitFor(() =>
          expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("m2"),
        );
      });
    });

    it("marks a session in the list that finished since its page was open, until it is opened", async () => {
      const held = { id: 0 };
      holdPrompt(held);
      const user = userEvent.setup();
      const composer = await startFromDialog(user);
      await user.type(composer, "Go{Enter}");
      const key = Object.keys(useRunningAgentSessionsStore.getState().sessions)[0];
      act(() => useShellStore.getState().setMainSurface({ kind: "agent-sessions" }));
      act(() => agent.respond(held.id, { stopReason: "end_turn" }));
      const row = await screen.findByRole("button", { name: "Open Fake Agent: Go, new" });
      expect(useRunningAgentSessionsStore.getState().unseen).toEqual({ [key]: true });
      await user.click(row);
      await waitFor(() => expect(useRunningAgentSessionsStore.getState().unseen).toEqual({}));
    });

    it("offers the agent's modes", async () => {
      agent
        .on("session/new", () => ({
          sessionId: "sess_1",
          modes: {
            currentModeId: "ask",
            availableModes: [
              { id: "ask", name: "Ask" },
              { id: "code", name: "Code" },
            ],
          },
        }))
        .on("session/set_mode", () => ({}));
      const user = userEvent.setup();
      await startFromDialog(user);
      await user.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "code");
      await waitFor(() =>
        expect(agent.requests("session/set_mode")[0]?.params).toEqual({
          sessionId: "sess_1",
          modeId: "code",
        }),
      );
    });

    describe("RIM's tools", () => {
      it("says nothing while the agent has them", async () => {
        await startFromDialog(userEvent.setup());
        expect(screen.queryByText(bridgeOffSentence("Fake Agent"))).toBeNull();
        expect(screen.queryByText(agentCannotSentence("Fake Agent"))).toBeNull();
      });

      it("says they are off, with a way to Settings → Agents", async () => {
        bridge({ ...BRIDGE_ON, enabled: false, listening: false });
        const user = userEvent.setup();
        await startFromDialog(user);
        expect(screen.getByText(bridgeOffSentence("Fake Agent"))).toBeInTheDocument();
        expect(bridgeOffSentence("Fake Agent")).toBe(
          "RIM's tools are off. Turn on Let agents on this computer connect in Settings → Agents to let Fake Agent read and post in RIM.",
        );
        await user.click(screen.getByRole("button", { name: "Open Settings → Agents" }));
        expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agents" });
      });

      it("says when the agent can't use them", async () => {
        agent.on("initialize", () => helloAnswer(false));
        await startFromDialog(userEvent.setup());
        expect(screen.getByText("Fake Agent can't use RIM's tools.")).toBeInTheDocument();
      });
    });
  });

  describe("signing in", () => {
    it("offers Sign in when the agent needs it to open a session, then tries again", async () => {
      const user = userEvent.setup();
      let signedIn = false;
      agent.on("session/new", (_params, id) => {
        if (signedIn) return { sessionId: "sess_2" };
        queueMicrotask(() => agent.fail(id, -32000, "Authentication required"));
        return undefined;
      });
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Start a session" }));
      const start = await screen.findByRole("dialog", { name: "Start an agent session" });
      await user.click(within(start).getByRole("button", { name: "Start" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Fake Agent needs you to sign in first.",
      );
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Sign in to Fake Agent" }));
      const dialog = await screen.findByRole("dialog", { name: "Sign in to Fake Agent" });
      await user.click(within(dialog).getByRole("button", { name: "Signed in" }));
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      signedIn = true;
      const runs = agent.startAgentRun.mock.calls.length;
      await user.click(screen.getByRole("button", { name: "Try again" }));
      const composer = await screen.findByRole("textbox", { name: "Prompt for Fake Agent" });
      await waitFor(() => expect(composer).toBeEnabled());
      expect(agent.startAgentRun).toHaveBeenCalledTimes(runs + 1);
      expect(agent.startAgentRun).toHaveBeenLastCalledWith({
        program: "/usr/bin/fake-agent",
        args: ["acp"],
        cwd: "/home/a/project",
      });
      expect(
        screen.queryByRole("button", { name: "Sign in to Fake Agent" }),
      ).not.toBeInTheDocument();
    });

    it("sends the refused prompt again in the new session after signing in", async () => {
      const user = userEvent.setup();
      let signedIn = false;
      agent.on("session/prompt", (_params, id) => {
        if (signedIn) return { stopReason: "end_turn" };
        queueMicrotask(() => agent.fail(id, -32000, "Authentication required"));
        return undefined;
      });
      const composer = await startFromDialog(user);
      await user.type(composer, "Fix the build{Enter}");
      expect(await screen.findByText("Fake Agent needs you to sign in first.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Sign in to Fake Agent" }));
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Signed in" }),
      );
      signedIn = true;
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(prompts()).toHaveLength(2));
      expect(prompts()[1]).toEqual([{ type: "text", text: "Fix the build" }]);
      expect(agent.stopAgentRun).toHaveBeenCalled();
    });
  });

  describe("reopening", () => {
    function recent(canReopen: boolean) {
      useAgentSessionsStore.getState().upsert({
        key: "old",
        profileId: "p1",
        agentName: "Fake Agent",
        cwd: "/home/a/project",
        acpSessionId: "acp-old",
        title: "Earlier work",
        startedAt: "2026-11-09T10:00:00.000Z",
        lastActivityAt: "2026-11-09T11:00:00.000Z",
        canReopen,
      });
    }

    it("reopens a recent session through session/load, replaying its history", async () => {
      recent(true);
      agent.on("session/load", (_params, id) => {
        queueMicrotask(() => {
          agent.update("acp-old", {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "What broke?" },
          });
          agent.respond(id, {});
        });
        return undefined;
      });
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Reopen Fake Agent: Earlier work" }));
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "agent-session", key: "old" });
      const composer = await screen.findByRole("textbox", { name: "Prompt for Fake Agent" });
      await waitFor(() => expect(composer).toBeEnabled());
      expect(agent.requests("session/load")[0].params).toMatchObject({
        sessionId: "acp-old",
        cwd: "/home/a/project",
      });
      expect(screen.getByText("What broke?")).toBeInTheDocument();
      expect(agentSessionOf("old")?.status).toBe("ready");
    });

    it("opens read-only when the agent can't reopen sessions", async () => {
      recent(false);
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Open Fake Agent: Earlier work" }));
      expect(
        screen.getByText("Fake Agent can't reopen past sessions. Start a new one."),
      ).toBeInTheDocument();
      expect(screen.getByText(sandboxSentence("/home/a/project"))).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(agent.startAgentRun).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Start a session" }));
      expect(useStartAgentSessionStore.getState().open).toBe(true);
    });

    it("drops a recent session from the list only", async () => {
      recent(true);
      useShellStore.getState().setMainSurface({ kind: "agent-sessions" });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(
        screen.getByRole("button", { name: "Remove Fake Agent: Earlier work from the list" }),
      );
      expect(useAgentSessionsStore.getState().recent).toEqual([]);
      expect(screen.getByText("No agent sessions yet.")).toBeInTheDocument();
      expect(agent.startAgentRun).not.toHaveBeenCalled();
      expect(useRunningAgentSessionsStore.getState().sessions).toEqual({});
    });
  });
});
