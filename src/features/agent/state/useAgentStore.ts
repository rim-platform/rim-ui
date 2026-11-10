import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

export type AgentStatus = "idle" | "streaming" | "done" | "error";

interface AgentSettings {
  providerId: string;
  modelId: string;
  systemPrompt: string;
}

/** A prompt or an answer of an agent conversation, sent to the model with the later prompts. */
export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/**
 * A line of the transcript where the person switched models: `content` is the new model's name.
 * It is shown only and never sent to a model.
 */
export interface AgentModelSwitch {
  role: "model-switch";
  content: string;
  timestamp: string;
}

/** One entry of an agent conversation's transcript. */
export type AgentMessage = AgentChatMessage | AgentModelSwitch;

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
  switchModel: (providerId: string, modelId: string, modelName: string) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Moves settings stored under the separate `rim-agent-settings` localStorage key into the
// store's defaults, and removes that key.
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
        modelId: oldSettings.modelId ?? "claude-sonnet-5-5",
        systemPrompt: oldSettings.systemPrompt ?? "",
      },

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
            const trimmed =
              messages.length > MAX_MESSAGES_PER_CONVERSATION
                ? messages.slice(messages.length - MAX_MESSAGES_PER_CONVERSATION)
                : messages;
            return {
              ...c,
              messages: trimmed,
              title:
                c.messages.length === 0 && msg.role === "user" ? msg.content.slice(0, 60) : c.title,
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

      setActiveConversation: (id) =>
        set({
          activeConversationId: id,
          status: "idle",
          toolActivity: null,
          usage: null,
        }),

      // Appends to the last assistant message in the active conversation, or starts one
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

      reset: () =>
        set({
          status: "idle",
          toolActivity: null,
          usage: null,
        }),

      updateSettings: (patch) => {
        set((state) => ({
          settings: { ...state.settings, ...patch },
        }));
      },

      // Sets the model the next turn uses, the same setting the settings panel sets, and marks
      // the switch in the open conversation's transcript once it has messages. Refused while a
      // turn runs. Two switches in a row leave one line, naming the last model chosen.
      switchModel: (providerId, modelId, modelName) => {
        const state = get();
        if (state.status === "streaming") return;
        const { settings } = state;
        if (settings.providerId === providerId && settings.modelId === modelId) return;
        const line: AgentModelSwitch = {
          role: "model-switch",
          content: modelName,
          timestamp: new Date().toISOString(),
        };
        set({
          settings: { ...settings, providerId, modelId },
          conversations: state.conversations.map((c) => {
            if (c.id !== state.activeConversationId || c.messages.length === 0) return c;
            const last = c.messages[c.messages.length - 1];
            const kept = last.role === "model-switch" ? c.messages.slice(0, -1) : c.messages;
            return { ...c, messages: [...kept, line] };
          }),
        });
      },
    }),
    {
      name: "rim-agent-store",
      partialize: (state) => ({
        // Only persist the most recent 5 conversations to avoid unbounded
        // storage growth (up to 20 conversations x 100 messages each).
        conversations: state.conversations.slice(0, 5),
        activeConversationId: state.activeConversationId,
        settings: state.settings,
      }),
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useAgentStore);
