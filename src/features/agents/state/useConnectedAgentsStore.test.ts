import { afterEach, describe, expect, it } from "vitest";

import { migrateConnectedAgents, useConnectedAgentsStore } from "./useConnectedAgentsStore";

const STORED = {
  id: "agent-1",
  name: "Claude Code",
  tokenHash: "hash",
  pairedAt: "2026-11-06T10:00:00.000Z",
  grants: { w1: { all: true, channelIds: [] } },
  pluginApprovals: { "dev.example.pods": { manifestHash: "h", commandIds: ["list"] } },
};

describe("useConnectedAgentsStore", () => {
  afterEach(() => {
    useConnectedAgentsStore.setState({ agents: [] });
  });

  it("gives an agent stored before RIM commands could be approved none of them", () => {
    expect(migrateConnectedAgents({ agents: [STORED] })).toEqual({
      agents: [{ ...STORED, commandApprovals: [] }],
    });
  });

  it("keeps the RIM commands an agent was stored with", () => {
    const agent = { ...STORED, commandApprovals: ["chat.set_topic"] };
    expect(migrateConnectedAgents({ agents: [agent] }).agents[0].commandApprovals).toEqual([
      "chat.set_topic",
    ]);
  });

  it("fills in missing plugin approvals and takes anything else as no agents", () => {
    const { pluginApprovals: _left, ...bare } = STORED;
    expect(migrateConnectedAgents({ agents: [bare] }).agents[0]).toMatchObject({
      pluginApprovals: {},
      commandApprovals: [],
    });
    expect(migrateConnectedAgents(null)).toEqual({ agents: [] });
    expect(migrateConnectedAgents({ agents: "x" })).toEqual({ agents: [] });
  });

  it("replaces one agent's RIM commands, once each, and marks its scope changed", () => {
    useConnectedAgentsStore.setState({
      agents: [
        { ...STORED, commandApprovals: [] },
        { ...STORED, id: "agent-2", commandApprovals: ["kept"] },
      ],
    });
    useConnectedAgentsStore
      .getState()
      .setCommandApprovals("agent-1", ["chat.set_topic", "chat.set_topic", "chat.pin_message"]);
    const [first, second] = useConnectedAgentsStore.getState().agents;
    expect(first.commandApprovals).toEqual(["chat.set_topic", "chat.pin_message"]);
    expect(first.scopeChangedAt).toEqual(expect.any(String));
    expect(second.commandApprovals).toEqual(["kept"]);
  });

  it("takes the approvals away with the agent", () => {
    useConnectedAgentsStore.setState({ agents: [{ ...STORED, commandApprovals: ["x"] }] });
    useConnectedAgentsStore.getState().revoke("agent-1");
    expect(useConnectedAgentsStore.getState().agents).toEqual([]);
  });
});
