import { beforeEach, describe, expect, it } from "vitest";

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { quoteName, readAgentContext } from "./agentContext";
import { registerGetCurrentContextTool } from "./getCurrentContext";
import { getTool, unregisterTool } from "./registry";

const DIRECT = "direct-1";

beforeEach(() => {
  queryClient.clear();
  useShellStore.getState().reset();
  useWorkspaceStore.getState().clearWorkspaceId();
  useRelayStore.setState({ info: { directSpaceId: DIRECT } as never, spaces: {} });
});

describe("quoteName", () => {
  it("quotes a name and escapes what could end the quote or the line", () => {
    expect(quoteName('a"b\nc')).toBe(String.raw`"a\"b\nc"`);
  });

  it("shows invisible characters by name", () => {
    expect(quoteName("gen\u200Beral")).toBe('"gen⟦U+200B⟧eral"');
  });

  it("cuts a long name", () => {
    expect(quoteName("x".repeat(500))).toBe(`"${"x".repeat(80)}..."`);
  });
});

describe("readAgentContext", () => {
  it("leaves direct spaces out of the workspaces", () => {
    queryClient.setQueryData(queryKeys.myServers(), [
      { id: "w1", name: "One", owner: null },
      { id: DIRECT, name: "Direct", owner: null },
    ]);
    useWorkspaceStore.getState().setWorkspaceId(DIRECT);

    const context = readAgentContext();

    expect(context.workspaces).toEqual([{ id: "w1", name: "One" }]);
    expect(context.inDirectMessages).toBe(true);
    expect(context.workspaceName).toBeNull();
    expect(context.workspaceOnScreen).toBe(false);
  });

  it("finds a conversation's name in the cached lists", () => {
    useWorkspaceStore.getState().setWorkspaceId("w1");
    useShellStore.getState().setSelectedConversationId("c1");
    queryClient.setQueryData(queryKeys.joinedChannels("w1"), {
      items: [{ id: "c1", title: "general", conversationType: ConversationTypeEnum.CHANNEL }],
    });

    const context = readAgentContext();

    expect(context.conversationName).toBe("general");
    expect(context.conversationOnScreen).toBe(true);
    expect(context.surface).toBe("a conversation");
  });

  it("gives no title for an encrypted conversation or anything but a channel", () => {
    useWorkspaceStore.getState().setWorkspaceId("w1");
    useShellStore.getState().setSelectedConversationId("c1");
    const cached = (extra: object) =>
      queryClient.setQueryData(queryKeys.conversation("w1", "c1"), {
        id: "c1",
        title: "Private title",
        ...extra,
      });

    cached({ conversationType: ConversationTypeEnum.CHANNEL, encryptedAt: "2026-11-07T00:00:00Z" });
    expect(readAgentContext().conversationName).toBeNull();

    cached({ conversationType: ConversationTypeEnum.GROUP });
    expect(readAgentContext().conversationName).toBeNull();

    cached({ conversationType: ConversationTypeEnum.DIRECT });
    expect(readAgentContext().conversationName).toBeNull();
  });

  it("knows a conversation stays selected but off screen on another view", () => {
    useWorkspaceStore.getState().setWorkspaceId("w1");
    useShellStore.getState().setSelectedConversationId("c1");
    useShellStore.getState().setMainSurface({ kind: "unreads" });

    const context = readAgentContext();

    expect(context.conversationOnScreen).toBe(false);
    expect(context.workspaceOnScreen).toBe(false);
    expect(context.surface).toBe("Unreads, across every workspace");
  });
});

describe("workspaces on other servers", () => {
  it("names them apart from the ones the tools can reach", () => {
    useRelayStore.setState({
      spaces: {
        r1: { account: "a", spaceId: "r1", hostServerId: "h", kind: "workspace", name: "Far" },
        r2: { account: "a", spaceId: "r2", hostServerId: "h", kind: "direct" },
      },
    });
    useWorkspaceStore.getState().setWorkspaceId("r1");

    const context = readAgentContext();

    expect(context.workspacesElsewhere).toEqual(["Far"]);
    expect(context.selectedIsElsewhere).toBe(true);
    expect(context.workspaceName).toBe("Far");
  });
});

describe("get_current_context", () => {
  it("answers with the view, cleaned names and whether it is Direct messages", async () => {
    queryClient.setQueryData(queryKeys.myServers(), [{ id: "w1", name: "One\u202E", owner: null }]);
    useWorkspaceStore.getState().setWorkspaceId("w1");
    useShellStore.getState().setMainSurface({ kind: "settings" });

    registerGetCurrentContextTool();
    const result = JSON.parse(await getTool("get_current_context")!.handler({}));
    unregisterTool("get_current_context");

    expect(result).toEqual({
      view: "Settings",
      workspaceId: "w1",
      workspaceName: "One⟦U+202E⟧",
      inDirectMessages: false,
      workspaces: [{ id: "w1", name: "One⟦U+202E⟧" }],
      workspacesOnOtherServersNotReachable: [],
      conversationId: null,
      conversationName: null,
      isThreadOpen: false,
      rootMessageId: null,
    });
  });
});
