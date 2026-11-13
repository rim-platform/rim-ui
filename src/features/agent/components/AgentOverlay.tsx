import { useEffect, useRef, useCallback, useState } from "react";
import { Bot, X, Loader2, Square, Sparkles, Send, Plus } from "lucide-react";

import { Z } from "../../../shared/ui/zIndex";
import { cn } from "../../../shared/ui/cn";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { useAgentStore } from "../state/useAgentStore";
import { liveModel, useLiveModelsStore } from "../state/useLiveModelsStore";
import type { AgentChatMessage, AgentMessage } from "../state/useAgentStore";
import { runAgent } from "../runtime/agentEngine";
import type { AiMessage, AiModelDef } from "../providers/types";
import { loadAgentTools } from "../tools/loader";
import { invoke } from "@tauri-apps/api/core";
import { getProvider } from "../providers/registry";
import { loadProvider } from "../providers/configuredProvider";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { settingsTabCommandId } from "../../settings/settingsTabs";
import { AgentDisclaimerDialog } from "./AgentDisclaimerDialog";
import { AgentModelPicker } from "./AgentModelPicker";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { Dialog } from "../../../shared/ui/Dialog";
import { FeatureOffNotice } from "../../updater/components/FeatureOffNotice";
import { useServerFeature } from "../../updater/hooks/useServerFeature";
import type { ServerFeatureView } from "../../updater/hooks/useServerFeature";
import { AI_COMMANDS_OFF_MESSAGE } from "../aiCommandsOff";
import { AGENT_DESKTOP_ONLY_MESSAGE, agentAvailable } from "../agentAvailability";

// Register tools once per workspace (hardcoded builtins + backend AI surface, the backend
// winning a name clash). The backend AI surface is per workspace (feature-gated commands
// are only offered where the feature is on), so switching workspace reloads the registry. A load
// that could not reach the server is tried again on the next use.
let toolsRegisteredFor: string | null | undefined;
let toolsLoading: Promise<void> | null = null;
let toolsLoadingFor: string | null | undefined;
function ensureToolsRegistered(): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (toolsRegisteredFor !== undefined && toolsRegisteredFor === workspaceId) {
    return Promise.resolve();
  }
  if (toolsLoading && toolsLoadingFor === workspaceId) return toolsLoading;
  toolsLoadingFor = workspaceId;
  toolsLoading = loadAgentTools()
    .then((result) => {
      toolsRegisteredFor = result.fetchFailed ? undefined : workspaceId;
    })
    .finally(() => {
      toolsLoading = null;
    });
  return toolsLoading;
}

// Providers are registered once per providerId. The provider never holds the
// key: the Rust proxy reads it from the secret vault on every request, so
// switching the key in Settings is invisible at this layer and the next
// `chat()` uses whatever the keyring currently holds. A provider this app does
// not support stays unregistered, and the run says so.
async function ensureProviderRegistered(providerId: string): Promise<void> {
  await loadProvider(providerId).catch(() => undefined);
}

const DISCLAIMER_FLAG = "agent-disclaimer-accepted";

function isDisclaimerAccepted(): boolean {
  return localStorage.getItem(DISCLAIMER_FLAG) === "true";
}

function acceptDisclaimer(): void {
  localStorage.setItem(DISCLAIMER_FLAG, "true");
}

/**
 * The prompts and answers of a transcript as the provider takes them. The history is plain text
 * in every provider's shape, so a conversation continues after a switch to another provider;
 * the lines marking a switch are left out.
 */
function toAiMessages(messages: AgentMessage[]): AiMessage[] {
  return messages
    .filter((m): m is AgentChatMessage => m.role !== "model-switch")
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
}

export function AgentOverlay() {
  const desktop = agentAvailable();
  const isOpen = useAgentStore((s) => s.isOpen);
  const status = useAgentStore((s) => s.status);
  const toolActivity = useAgentStore((s) => s.toolActivity);
  const usage = useAgentStore((s) => s.usage);
  const settings = useAgentStore((s) => s.settings);
  const modelLabel = useLiveModelsStore(
    (s) =>
      liveModel(s.byProvider, settings.providerId, settings.modelId)?.name ??
      getProvider(settings.providerId)?.config.models.find((m) => m.id === settings.modelId)
        ?.name ??
      settings.modelId,
  );
  const switchModel = useAgentStore((s) => s.switchModel);
  const close = useAgentStore((s) => s.close);
  const reset = useAgentStore((s) => s.reset);
  const startNewConversation = useAgentStore((s) => s.startNewConversation);
  const addMessage = useAgentStore((s) => s.addMessage);

  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConversation?.messages ?? [];

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const aiCommands = useServerFeature("ai_commands");
  const agentOn = aiCommands.enabled;

  // Focus input on open + check disclaimer
  useEffect(() => {
    if (isOpen && agentOn && desktop) {
      ensureToolsRegistered();

      if (!disclaimerChecked) {
        setDisclaimerChecked(true);
        if (!isDisclaimerAccepted()) {
          setShowDisclaimer(true);
        }
      }

      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, disclaimerChecked, agentOn, desktop]);

  // Global Escape handler
  useEffect(() => {
    if (!isOpen) return;
    function handleGlobalEscape(e: KeyboardEvent) {
      // An open menu, such as the model picker, closes on its own Escape.
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (status === "streaming") {
          abortRef.current?.abort();
          useAgentStore.getState().setStatus("idle");
        } else {
          useAgentStore.getState().close();
        }
      }
    }
    window.addEventListener("keydown", handleGlobalEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalEscape, { capture: true });
  }, [isOpen, status]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [messages, toolActivity]);

  const handleDisclaimerAccept = useCallback(() => {
    void acceptDisclaimer();
    setShowDisclaimer(false);
  }, []);

  const handleDisclaimerCancel = useCallback(() => {
    setShowDisclaimer(false);
    close();
  }, [close]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || status === "streaming") return;

    const convId = activeConversationId;
    if (!convId) return;

    // Add user message to conversation
    addMessage(convId, {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    });

    setInputValue("");
    reset();

    const abort = new AbortController();
    abortRef.current = abort;

    // Build existing messages for context (before the new prompt)
    const existingAiMessages = toAiMessages(
      useAgentStore
        .getState()
        .conversations.find((c) => c.id === convId)
        ?.messages.slice(0, -1) ?? [],
    );

    void (async () => {
      // Presence-check the secret vault before spinning up runAgent. The keyring
      // is the single source of truth for provider keys. No key bytes are held
      // here — the Rust proxy reads from the keyring inline per-request.
      const hasKey = await invoke<boolean>("is_provider_key_configured", {
        provider: settings.providerId,
      });
      if (!hasKey) {
        useAgentStore.getState().appendText("Add your AI provider key in Settings > Assistant.");
        useAgentStore.getState().setStatus("error");
        return;
      }

      await ensureProviderRegistered(settings.providerId);
      await ensureToolsRegistered();

      await runAgent({
        prompt: trimmed,
        providerId: settings.providerId,
        modelId: settings.modelId,
        systemPrompt: settings.systemPrompt || undefined,
        signal: abort.signal,
        existingMessages: existingAiMessages.length > 0 ? existingAiMessages : undefined,
      });
    })();
  }, [inputValue, status, settings, activeConversationId, reset, addMessage]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    useAgentStore.getState().setStatus("idle");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (status === "streaming") {
          handleCancel();
        } else {
          close();
        }
      }
    },
    [handleSubmit, handleCancel, close, status],
  );

  const handleNewConversation = useCallback(() => {
    startNewConversation();
    setInputValue("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [startNewConversation]);

  const handleModelPick = useCallback(
    (providerId: string, model: AiModelDef) => {
      switchModel(providerId, model.id, model.name);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [switchModel],
  );

  const handleOpenModelSettings = useCallback(() => {
    close();
    void runCommandFromClick(settingsTabCommandId("agent"), undefined, { source: "menu" });
  }, [close]);

  if (!isOpen) return null;

  if (!desktop) return <AgentDesktopOnly onClose={close} />;

  if (!agentOn) return <AgentOff view={aiCommands} onClose={close} />;

  if (showDisclaimer) {
    return (
      <AgentDisclaimerDialog
        open={showDisclaimer}
        onAccept={handleDisclaimerAccept}
        onCancel={handleDisclaimerCancel}
      />
    );
  }

  const isStreaming = status === "streaming";
  const hasMessages = messages.length > 0;
  const showUsage = usage && (status === "done" || status === "error");

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[12vh]"
      style={{ zIndex: Z.OVERLAY_CONTENT }}
      onClick={close}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex w-full max-w-2xl flex-col rounded-xl border border-rim-line bg-rim-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const focusable = e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) {
              if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
              }
            } else {
              if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }
        }}
        style={{ maxHeight: "70vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
          <Bot className="h-4 w-4 shrink-0 text-rim-accent" />
          <span className="shrink-0 text-sm font-medium text-rim-text">Assistant</span>
          <AgentModelPicker
            label={modelLabel}
            disabled={isStreaming}
            onPick={handleModelPick}
            onOpenSettings={handleOpenModelSettings}
          />
          <button
            type="button"
            onClick={handleNewConversation}
            className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-accent"
            title="New conversation"
            aria-label="New conversation"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
            aria-label="Close assistant"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message list */}
        {hasMessages && (
          <div ref={outputRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((msg, i) => (
              <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
            ))}

            {/* Tool activity indicator */}
            {toolActivity && (
              <div className="flex items-center gap-2 text-xs text-rim-text-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{toolActivity}</span>
              </div>
            )}

            {/* Streaming cursor */}
            {isStreaming && !toolActivity && (
              <span className="inline-block h-4 w-0.5 animate-pulse bg-rim-accent" />
            )}
          </div>
        )}

        {/* Empty state */}
        {!hasMessages && status === "idle" && (
          <div className="flex flex-col items-center py-10 text-center">
            <Sparkles className="mb-2 h-6 w-6 text-rim-accent/40" />
            <p className="text-sm text-rim-text-muted">Ask anything about your workspace</p>
            <p className="mt-1 text-xs text-rim-text-faint">
              Messages, channels, members: the assistant can search and summarize them for you.
            </p>
          </div>
        )}

        {/* Usage footer */}
        {showUsage && (
          <div className="border-t border-rim-line/50 px-4 py-1.5 text-[10px] text-rim-text-faint">
            {usage.inputTokens} in / {usage.outputTokens} out tokens
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-rim-line px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the assistant..."
              disabled={isStreaming}
              className={cn(
                "flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted",
                isStreaming && "opacity-50",
              )}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded p-1.5 text-rim-danger transition hover:bg-rim-danger/10"
                aria-label="Cancel"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!inputValue.trim()}
                className={cn(
                  "rounded p-1.5 transition",
                  inputValue.trim()
                    ? "text-rim-accent hover:bg-rim-accent/10"
                    : "text-rim-text-faint",
                )}
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The agent's place while the server has the AI command surface switched off. */
function AgentOff({ view, onClose }: { view: ServerFeatureView; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Assistant">
      <FeatureOffNotice feature="ai_commands" view={view} message={AI_COMMANDS_OFF_MESSAGE} />
    </Dialog>
  );
}

/** The agent's place in an app without the agent: says where it runs, with no error. */
function AgentDesktopOnly({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Assistant">
      <p role="status" className="text-sm text-rim-text-muted">
        {AGENT_DESKTOP_ONLY_MESSAGE}
      </p>
    </Dialog>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  if (message.role === "model-switch") return <ModelSwitchLine model={message.content} />;
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2",
          isUser ? "bg-rim-accent/15 text-rim-text" : "bg-rim-void text-rim-text",
        )}
      >
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <MarkdownRenderer
            content={message.content}
            className="text-sm leading-relaxed prose-rim"
          />
        )}
      </div>
    </div>
  );
}

/** The transcript's mark where the person switched to `model`; later answers come from it. */
function ModelSwitchLine({ model }: { model: string }) {
  return (
    <div role="note" className="flex items-center gap-2 text-[11px] text-rim-text-faint">
      <span aria-hidden="true" className="h-px flex-1 bg-rim-line" />
      <span>Switched to {model}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-rim-line" />
    </div>
  );
}
