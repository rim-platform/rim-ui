import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const copied = vi.hoisted(() => vi.fn<(text: string) => void>());
vi.mock("../../../shared/ui/contextMenu/menuActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/contextMenu/menuActions")>()),
  copyToClipboard: copied,
}));
vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import type { AgentBridgeStatus } from "../api/agentBridge";
import { sha256Base64Url } from "../runtime/agentCrypto";
import { TOOL_SETUPS } from "../runtime/connectSnippets";
import { NAME_RULE } from "../runtime/pairing";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";
import { BRIDGE_SWITCH_LABEL, ConnectAgentDialog, TOKEN_WARNING } from "./ConnectAgentDialog";

const ON: AgentBridgeStatus = { enabled: true, listening: true, error: null, port: 47999 };
const OFF: AgentBridgeStatus = { ...ON, enabled: false, listening: false };
const ADDRESS = "http://127.0.0.1:47999/mcp";
const TOKEN_SHAPE = /rimagent_[A-Za-z0-9_-]{43}/;

function open(status: AgentBridgeStatus | null = ON) {
  const onClose = vi.fn();
  const onTurnOn = vi.fn();
  const view = render(<ConnectAgentDialog status={status} onTurnOn={onTurnOn} onClose={onClose} />);
  return { onClose, onTurnOn, view };
}

/** Names the agent, connects it and gives the token the Copy button of the token hands over. */
async function connected(user: ReturnType<typeof userEvent.setup>, name = "Codex on laptop") {
  await user.type(screen.getByRole("textbox", { name: /Name/ }), name);
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("dialog", { name: "Set up the agent" });
  copied.mockClear();
  await user.click(screen.getByRole("button", { name: "Copy token" }));
  const token = copied.mock.calls[0][0];
  copied.mockClear();
  return token;
}

afterEach(() => {
  vi.clearAllMocks();
  useConnectedAgentsStore.setState({ agents: [] });
});

describe("ConnectAgentDialog", () => {
  it("connects the named agent with nothing granted, and shows its setup", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByRole("dialog", { name: "Connect an agent" })).toBeInTheDocument();
    const token = await connected(user);

    expect(token).toMatch(new RegExp(`^${TOKEN_SHAPE.source}$`));
    const { agents } = useConnectedAgentsStore.getState();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "Codex on laptop",
      tokenHash: await sha256Base64Url(token),
      grants: {},
      pluginApprovals: {},
      commandApprovals: [],
    });
    expect(screen.getByLabelText("Address")).toHaveTextContent(ADDRESS);
    expect(screen.getByRole("note")).toHaveTextContent(TOKEN_WARNING);
    expect(TOKEN_WARNING).toBe(
      "The token is saved in that tool's settings file. Any program running as you can read it. RIM won't show it again. If you lose it, disconnect this agent and connect again.",
    );
  });

  it("hides the token until Show, everywhere it appears", async () => {
    const user = userEvent.setup();
    open();
    const token = await connected(user);
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent(token);
    expect(dialog.textContent).not.toMatch(TOKEN_SHAPE);

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByLabelText("Token")).toHaveTextContent(token);
    expect(screen.getByLabelText("Claude Code setup")).toHaveTextContent(token);

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(dialog).not.toHaveTextContent(token);
  });

  it("gives every tool a snippet with the token and the address", async () => {
    const user = userEvent.setup();
    open();
    const token = await connected(user);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Claude Code",
      "Codex",
      "opencode",
      "Gemini CLI",
      "Cursor",
      "VS Code",
      "Generic",
    ]);
    for (const setup of TOOL_SETUPS) {
      await user.click(screen.getByRole("tab", { name: setup.label }));
      expect(screen.getByRole("tab", { name: setup.label })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tabpanel")).toHaveTextContent(setup.where);
      await user.click(screen.getByRole("button", { name: `Copy ${setup.label} setup` }));
      const snippet = copied.mock.calls.at(-1)![0];
      expect(snippet, setup.id).toContain(`Bearer ${token}`);
      expect(snippet, setup.id).toContain(ADDRESS);
      expect(snippet, setup.id).toBe(setup.snippet(ADDRESS, token));
    }
  });

  it("writes each tool's own format", () => {
    const snippet = (id: string) =>
      TOOL_SETUPS.find((setup) => setup.id === id)!.snippet(ADDRESS, "rimagent_T");
    expect(snippet("claude-code")).toBe(
      `claude mcp add --transport http rim ${ADDRESS} --header "Authorization: Bearer rimagent_T"`,
    );
    expect(snippet("codex")).toBe(
      `[mcp_servers.rim]\nurl = "${ADDRESS}"\nhttp_headers = { Authorization = "Bearer rimagent_T" }`,
    );
    const headers = { Authorization: "Bearer rimagent_T" };
    expect(JSON.parse(snippet("opencode"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: { rim: { type: "remote", url: ADDRESS, enabled: true, headers } },
    });
    expect(JSON.parse(snippet("gemini-cli"))).toEqual({
      mcpServers: { rim: { httpUrl: ADDRESS, headers } },
    });
    expect(JSON.parse(snippet("cursor"))).toEqual({
      mcpServers: { rim: { url: ADDRESS, headers } },
    });
    expect(JSON.parse(snippet("vscode"))).toEqual({
      servers: { rim: { type: "http", url: ADDRESS, headers } },
    });
    expect(snippet("generic")).toBe(`${ADDRESS}\nAuthorization: Bearer rimagent_T`);
  });

  it("moves between tools with the arrow keys", async () => {
    const user = userEvent.setup();
    open();
    await connected(user);
    screen.getByRole("tab", { name: "Claude Code" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Codex" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Generic" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the token once: Done closes it and the token is gone", async () => {
    const user = userEvent.setup();
    const { onClose, view } = open();
    const token = await connected(user);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Set up the agent" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Set up the agent")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(token);

    view.unmount();
    open();
    expect(screen.getByRole("dialog", { name: "Connect an agent" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(TOKEN_SHAPE);
    expect(useConnectedAgentsStore.getState().agents).toHaveLength(1);
  });

  it("refuses a name with nothing visible, saying the rule", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "   ");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(NAME_RULE);
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
    expect(screen.getByRole("dialog", { name: "Connect an agent" })).toBeInTheDocument();
  });

  it("says so while agents can't connect, offers the switch and connects nothing", async () => {
    const user = userEvent.setup();
    const { onTurnOn } = open(OFF);
    const dialog = screen.getByRole("dialog", { name: "Connect an agent" });
    expect(dialog).toHaveTextContent(
      `Agents can't connect while ${BRIDGE_SWITCH_LABEL} is off. Turn it on to connect one.`,
    );
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "Codex");
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);

    await user.click(within(dialog).getByRole("switch", { name: BRIDGE_SWITCH_LABEL }));
    expect(onTurnOn).toHaveBeenCalledWith(true);
  });

  it("connects nothing while the bridge's state is unknown", () => {
    open(null);
    expect(screen.getByText(/RIM can't tell whether agents may connect/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });
});
