import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AgentStatus = "idle" | "streaming" | "done" | "error";

interface AgentSettings {
  providerId: string;
  modelId: string;
  systemPrompt: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface AgentConversation {
  id: string;
  messages: AgentMessage[];
  createdAt: string;
  title: string;
}

const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES_PER_CONVERSATION = 100;

interface AgentState {
  // Overlay state
  isOpen: boolean;
  status: AgentStatus;
  toolActivity: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;

  // Conversations
  conversations: AgentConversation[];
  activeConversationId: string | null;

  // Settings (persisted via zustand persist)
  settings: AgentSettings;

  // API key status (key itself is NOT stored in zustand)
  hasApiKey: boolean;
  loadApiKeyStatus: "idle" | "loading" | "loaded";

  // Actions
  open: (prompt?: string) => void;
  close: () => void;
  startNewConversation: () => void;
  addMessage: (conversationId: string, msg: AgentMessage) => void;
  updateLastAssistantMessage: (conversationId: string, content: string) => void;
  setActiveConversation: (id: string | null) => void;
  appendText: (text: string) => void;
  setStatus: (status: AgentStatus) => void;
  setToolActivity: (activity: string | null) => void;
  setUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
  reset: () => void;
  updateSettings: (patch: Partial<AgentSettings>) => void;
  setHasApiKey: (has: boolean) => void;
  setLoadApiKeyStatus: (status: "idle" | "loading" | "loaded") => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Migrate old settings from separate localStorage key
function migrateOldSettings(): Partial<AgentSettings> {
  try {
    const old = localStorage.getItem("rim-agent-settings");
    if (old) {
      const parsed = JSON.parse(old);
      localStorage.removeItem("rim-agent-settings");
      return {
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        systemPrompt: parsed.systemPrompt,
      };
    }
  } catch {
    // ignore
  }
  return {};
}

const oldSettings = migrateOldSettings();

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      status: "idle",
      toolActivity: null,
      usage: null,

      conversations: [],
      activeConversationId: null,

      settings: {
        providerId: oldSettings.providerId ?? "anthropic",
        modelId: oldSettings.modelId ?? "claude-sonnet-4-20250514",
        systemPrompt: oldSettings.systemPrompt ?? "",
      },

      hasApiKey: false,
      loadApiKeyStatus: "idle",

      open: (prompt) => {
        const state = get();
        if (!state.activeConversationId || state.status === "done" || state.status === "error") {
          // Start a new conversation when opening fresh
          const conv: AgentConversation = {
            id: generateId(),
            messages: [],
            createdAt: new Date().toISOString(),
            title: prompt?.slice(0, 60) || "New conversation",
          };
          const conversations = [conv, ...state.conversations].slice(0, MAX_CONVERSATIONS);
          set({
            isOpen: true,
            conversations,
            activeConversationId: conv.id,
            status: "idle",
            toolActivity: null,
            usage: null,
          });
        } else {
          set({ isOpen: true });
        }
      },

      close: () => set({ isOpen: false }),

      startNewConversation: () => {
        const conv: AgentConversation = {
          id: generateId(),
          messages: [],
          createdAt: new Date().toISOString(),
          title: "New conversation",
        };
        const conversations = [conv, ...get().conversations].slice(0, MAX_CONVERSATIONS);
        set({
          conversations,
          activeConversationId: conv.id,
          status: "idle",
          toolActivity: null,
          usage: null,
        });
      },

      addMessage: (conversationId, msg) => {
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const messages = [...c.messages, msg];
            const trimmed = messages.length > MAX_MESSAGES_PER_CONVERSATION
              ? messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION)
              : messages;
            return {
              ...c,
              messages: trimmed,
              title: c.messages.length === 0 && msg.role === "user"
                ? msg.content.slice(0, 60)
                : c.title,
            };
          }),
        }));
      },

      updateLastAssistantMessage: (conversationId, content) => {
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            const msgs = [...c.messages];
            const lastIdx = msgs.length - 1;
            if (lastIdx >= 0 && msgs[lastIdx].role === "assistant") {
              msgs[lastIdx] = { ...msgs[lastIdx], content };
            }
            return { ...c, messages: msgs };
          }),
        }));
      },

      setActiveConversation: (id) => set({
        activeConversationId: id,
        status: "idle",
        toolActivity: null,
        usage: null,
      }),

      // Legacy appendText — appends to last assistant message in active conversation
      appendText: (text) => {
        const state = get();
        const convId = state.activeConversationId;
        if (!convId) return;
        const conv = state.conversations.find((c) => c.id === convId);
        if (!conv) return;
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          state.updateLastAssistantMessage(convId, lastMsg.content + text);
        } else {
          // Create a new assistant message
          state.addMessage(convId, {
            role: "assistant",
            content: text,
            timestamp: new Date().toISOString(),
          });
        }
      },

      setStatus: (status) => set({ status }),
      setToolActivity: (activity) => set({ toolActivity: activity }),
      setUsage: (usage) => set({ usage }),

      reset: () => set({
        status: "idle",
        toolActivity: null,
        usage: null,
      }),

      updateSettings: (patch) => {
        set((state) => ({
          settings: { ...state.settings, ...patch },
        }));
      },

      setHasApiKey: (has) => set({ hasApiKey: has }),
      setLoadApiKeyStatus: (status) => set({ loadApiKeyStatus: status }),
    }),
    {
      name: "rim-agent-store",
      partialize: (state) => ({
        // Only persist the most recent 5 conversations to avoid unbounded
        // localStorage growth (up to 20 conversations x 100 messages each).
        conversations: state.conversations.slice(0, 5),
        activeConversationId: state.activeConversationId,
        settings: state.settings,
      }),
    },
  ),
);
