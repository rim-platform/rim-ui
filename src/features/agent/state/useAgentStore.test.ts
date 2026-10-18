import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "./useAgentStore";
import type { AgentMessage } from "./useAgentStore";

describe("useAgentStore", () => {
  beforeEach(() => {
    useAgentStore.setState({
      isOpen: false,
      status: "idle",
      toolActivity: null,
      usage: null,
      conversations: [],
      activeConversationId: null,
      settings: {
        providerId: "anthropic",
        modelId: "claude-sonnet-5-5",
        systemPrompt: "",
      },
    });
  });

  it("starts with default state", () => {
    const state = useAgentStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.status).toBe("idle");
    expect(state.conversations).toEqual([]);
    expect(state.activeConversationId).toBeNull();
  });

  it("opens and creates a new conversation", () => {
    useAgentStore.getState().open("Hello");
    const state = useAgentStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).toBe(state.conversations[0].id);
    expect(state.conversations[0].title).toBe("Hello");
  });

  it("open with no prompt gives default title", () => {
    useAgentStore.getState().open();
    expect(useAgentStore.getState().conversations[0].title).toBe("New conversation");
  });

  it("closes the overlay", () => {
    useAgentStore.getState().open();
    useAgentStore.getState().close();
    expect(useAgentStore.getState().isOpen).toBe(false);
  });

  it("starts a new conversation", () => {
    useAgentStore.getState().open("First");
    useAgentStore.getState().startNewConversation();
    const state = useAgentStore.getState();
    expect(state.conversations).toHaveLength(2);
    expect(state.activeConversationId).toBe(state.conversations[0].id);
    expect(state.status).toBe("idle");
  });

  it("adds a message to a conversation", () => {
    useAgentStore.getState().open();
    const convId = useAgentStore.getState().activeConversationId!;
    const msg: AgentMessage = {
      role: "user",
      content: "Hello agent",
      timestamp: new Date().toISOString(),
    };
    useAgentStore.getState().addMessage(convId, msg);
    const conv = useAgentStore.getState().conversations.find((c) => c.id === convId)!;
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].content).toBe("Hello agent");
  });

  it("sets conversation title from first user message", () => {
    useAgentStore.getState().open();
    const convId = useAgentStore.getState().activeConversationId!;
    useAgentStore.getState().addMessage(convId, {
      role: "user",
      content: "What is the weather today?",
      timestamp: new Date().toISOString(),
    });
    const conv = useAgentStore.getState().conversations.find((c) => c.id === convId)!;
    expect(conv.title).toBe("What is the weather today?");
  });

  it("updates last assistant message", () => {
    useAgentStore.getState().open();
    const convId = useAgentStore.getState().activeConversationId!;
    useAgentStore.getState().addMessage(convId, {
      role: "assistant",
      content: "Partial",
      timestamp: new Date().toISOString(),
    });
    useAgentStore.getState().updateLastAssistantMessage(convId, "Partial response complete");
    const conv = useAgentStore.getState().conversations.find((c) => c.id === convId)!;
    expect(conv.messages[0].content).toBe("Partial response complete");
  });

  it("sets status", () => {
    useAgentStore.getState().setStatus("streaming");
    expect(useAgentStore.getState().status).toBe("streaming");
  });

  it("sets tool activity", () => {
    useAgentStore.getState().setToolActivity("Searching messages...");
    expect(useAgentStore.getState().toolActivity).toBe("Searching messages...");
  });

  it("sets usage", () => {
    useAgentStore.getState().setUsage({ inputTokens: 100, outputTokens: 50 });
    expect(useAgentStore.getState().usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it("resets status and activity but keeps conversations", () => {
    useAgentStore.getState().open();
    useAgentStore.getState().setStatus("streaming");
    useAgentStore.getState().setToolActivity("working");
    useAgentStore.getState().reset();
    const state = useAgentStore.getState();
    expect(state.status).toBe("idle");
    expect(state.toolActivity).toBeNull();
    expect(state.conversations).toHaveLength(1);
  });

  it("updates settings partially", () => {
    useAgentStore.getState().updateSettings({ modelId: "new-model" });
    const settings = useAgentStore.getState().settings;
    expect(settings.modelId).toBe("new-model");
    expect(settings.providerId).toBe("anthropic");
  });

  it("appendText creates new assistant message when none exists", () => {
    useAgentStore.getState().open();
    useAgentStore.getState().appendText("Hello ");
    const convId = useAgentStore.getState().activeConversationId!;
    const conv = useAgentStore.getState().conversations.find((c) => c.id === convId)!;
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe("assistant");
    expect(conv.messages[0].content).toBe("Hello ");
  });

  it("appendText appends to existing assistant message", () => {
    useAgentStore.getState().open();
    useAgentStore.getState().appendText("Hello ");
    useAgentStore.getState().appendText("world");
    const convId = useAgentStore.getState().activeConversationId!;
    const conv = useAgentStore.getState().conversations.find((c) => c.id === convId)!;
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].content).toBe("Hello world");
  });
});
