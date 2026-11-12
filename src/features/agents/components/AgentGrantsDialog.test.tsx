import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchChannels: vi.fn(), fetchMyServers: vi.fn() }));
vi.mock("../../conversations/api/useChannels", () => ({
  BROWSE_FILTER: { joinedOnly: false, includeArchived: false },
  fetchChannels: mocks.fetchChannels,
}));
vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => mocks.fetchMyServers(),
}));

import { useRelayStore } from "../../relay/state/useRelayStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { AgentGrantsDialog } from "./AgentGrantsDialog";

const ALL = "All channels you can see";
const ALL_NOTE = "Includes private channels you're in, and channels you join later.";
const INTRO =
  "Everything starts off. Reads don't prompt after this, and you can change this at any time.";
const NO_MORE = { hasNext: false, hasPrev: false };
const CLOSED =
  "Encrypted conversations, direct messages and groups stay closed. Agents can't read them.";
const PROVIDER =
  "What it reads goes to the model provider it uses. Once it has the content, RIM can't see or limit where it goes next.";

function agent(grants: ConnectedAgent["grants"] = {}): ConnectedAgent {
  return {
    id: "agent-1",
    name: "Claude Code",
    tokenHash: "hash",
    pairedAt: "2026-11-06T10:00:00.000Z",
    grants,
  };
}

function channel(id: string, title: string, fields: Record<string, unknown> = {}) {
  return { id, title, isPrivate: false, encryptedAt: null, ...fields };
}

function loaded(servers: { id: string; name: string }[]) {
  return { data: servers, isPending: false, isError: false, isSuccess: true };
}

const onClose = vi.fn();

function show(forAgent = agent()) {
  useConnectedAgentsStore.setState({ agents: [forAgent] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentGrantsDialog agent={forAgent} onClose={onClose} />
    </QueryClientProvider>,
  );
}

function grantsNow() {
  return useConnectedAgentsStore.getState().agents[0].grants;
}

async function checkbox(name: string | RegExp) {
  return screen.findByRole("checkbox", { name });
}

describe("AgentGrantsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRelayStore.setState({ info: null, spaces: {} });
    mocks.fetchMyServers.mockReturnValue(loaded([{ id: "w1", name: "Acme" }]));
    mocks.fetchChannels.mockResolvedValue({
      items: [channel("c1", "general"), channel("c2", "team", { isPrivate: true })],
      pageInfo: NO_MORE,
    });
  });

  it("says when a workspace has more channels than it lists", async () => {
    mocks.fetchChannels.mockResolvedValue({
      items: [channel("c1", "general")],
      pageInfo: { hasNext: true, hasPrev: false },
    });
    show();
    expect(
      await screen.findByText(/Only the first 1 channels are listed here/),
    ).toBeInTheDocument();
  });

  it("names the agent and shows the fixed words", async () => {
    show();
    expect(screen.getByRole("dialog", { name: "What can Claude Code read?" })).toBeInTheDocument();
    expect(screen.getByText(INTRO)).toBeInTheDocument();
    expect(screen.getByText(CLOSED)).toBeInTheDocument();
    expect(screen.getByText(PROVIDER)).toBeInTheDocument();
    expect(screen.getByText(ALL_NOTE)).toBeInTheDocument();
    await checkbox(/general/);
  });

  it("shows the two notices with no workspaces too", () => {
    mocks.fetchMyServers.mockReturnValue(loaded([]));
    show();
    expect(screen.getByText("You have no workspaces yet.")).toBeInTheDocument();
    expect(screen.getByText(CLOSED)).toBeInTheDocument();
    expect(screen.getByText(PROVIDER)).toBeInTheDocument();
  });

  it("asks for every channel the person can see", async () => {
    show();
    await checkbox(/general/);
    expect(mocks.fetchChannels).toHaveBeenCalledWith("w1", {
      joinedOnly: false,
      includeArchived: false,
    });
  });

  it("marks a private channel, and only a private one", async () => {
    show();
    expect(await checkbox(/team/)).toHaveAccessibleName("team private channel");
    expect(await checkbox(/general/)).toHaveAccessibleName("general");
  });

  it("offers no encrypted channel", async () => {
    mocks.fetchChannels.mockResolvedValue({
      items: [channel("c1", "general"), channel("c3", "hidden", { encryptedAt: "2026-11-01" })],
      pageInfo: NO_MORE,
    });
    show();
    await checkbox(/general/);
    expect(screen.queryByRole("checkbox", { name: /hidden/ })).toBeNull();
  });

  it("applies nothing before Save", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await checkbox(/general/));
    await user.click(screen.getByRole("checkbox", { name: new RegExp(ALL) }));
    expect(grantsNow()).toEqual({});
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(grantsNow()).toEqual({});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the channels ticked", async () => {
    const user = userEvent.setup();
    show();
    await user.click(await checkbox(/team/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({ w1: { all: false, channelIds: ["c2"] } });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unticks a channel", async () => {
    const user = userEvent.setup();
    show(agent({ w1: { all: false, channelIds: ["c1", "c2"] } }));
    await user.click(await checkbox(/general/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({ w1: { all: false, channelIds: ["c2"] } });
  });

  it("disables and ticks the channels under All, and saves all", async () => {
    const user = userEvent.setup();
    show(agent({ w1: { all: false, channelIds: ["c1"] } }));
    const team = await checkbox(/team/);
    expect(team).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: new RegExp(ALL) }));
    expect(team).toBeChecked();
    expect(team).toBeDisabled();
    expect(await checkbox(/general/)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({ w1: { all: true, channelIds: [] } });
  });

  it("gives back the channels ticked before when All is unticked", async () => {
    const user = userEvent.setup();
    show(agent({ w1: { all: false, channelIds: ["c1"] } }));
    const allBox = await checkbox(new RegExp(ALL));
    await user.click(allBox);
    await user.click(allBox);
    expect(await checkbox(/general/)).toBeChecked();
    expect(await checkbox(/team/)).not.toBeChecked();
    expect(await checkbox(/team/)).toBeEnabled();
  });

  it("keeps no entry for a workspace with nothing ticked", async () => {
    const user = userEvent.setup();
    show(agent({ w1: { all: false, channelIds: ["c1"] } }));
    await user.click(await checkbox(/general/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({});
  });

  it("drops a grant for a channel it no longer shows", async () => {
    const user = userEvent.setup();
    show(agent({ w1: { all: false, channelIds: ["c1", "left-behind"] } }));
    await checkbox(/general/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({ w1: { all: false, channelIds: ["c1"] } });
  });

  it("drops a grant in a workspace it no longer shows", async () => {
    const user = userEvent.setup();
    show(agent({ gone: { all: true, channelIds: [] } }));
    await checkbox(/general/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({});
  });

  it("leaves out the direct space", async () => {
    useRelayStore.setState({ info: { directSpaceId: "d1" } as never });
    mocks.fetchMyServers.mockReturnValue(
      loaded([
        { id: "d1", name: "Direct" },
        { id: "w1", name: "Acme" },
      ]),
    );
    show();
    await checkbox(/general/);
    expect(screen.queryByRole("heading", { name: "Direct" })).toBeNull();
    expect(mocks.fetchChannels).not.toHaveBeenCalledWith("d1", expect.anything());
  });

  it("shows a spinner while the workspaces load, and does not save", () => {
    mocks.fetchMyServers.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
    });
    show();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows a spinner while a workspace's channels load", () => {
    mocks.fetchChannels.mockReturnValue(new Promise(() => undefined));
    show();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: new RegExp(ALL) })).toBeEnabled();
  });

  it("says so when the workspaces cannot be loaded, and does not save", () => {
    mocks.fetchMyServers.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
    });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your workspaces");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps All and the grants when one workspace's channels fail", async () => {
    const user = userEvent.setup();
    mocks.fetchMyServers.mockReturnValue(
      loaded([
        { id: "w1", name: "Acme" },
        { id: "w2", name: "Other" },
      ]),
    );
    mocks.fetchChannels.mockImplementation(async (id: string) => {
      if (id === "w2") throw new Error("no");
      return { items: [channel("c1", "general")], pageInfo: NO_MORE };
    });
    show(agent({ w2: { all: false, channelIds: ["kept"] } }));
    const other = screen.getByRole("region", { name: "Other" });
    await waitFor(() =>
      expect(within(other).getByRole("alert")).toHaveTextContent(
        "Could not load this workspace's channels",
      ),
    );
    expect(within(other).getByRole("checkbox", { name: new RegExp(ALL) })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(grantsNow()).toEqual({ w2: { all: false, channelIds: ["kept"] } });
  });
});
