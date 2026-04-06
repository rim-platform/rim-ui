import { useEffect, useRef, useCallback, useState } from "react";
import { Bot, X, Loader2, Square, Sparkles, Send, Plus } from "lucide-react";

import { Z } from "../../../shared/ui/zIndex";
import { cn } from "../../../shared/ui/cn";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { useAgentStore } from "../state/useAgentStore";
import type { AgentMessage } from "../state/useAgentStore";
import { runAgent } from "../runtime/agentEngine";
import type { AiMessage } from "../providers/types";
import { registerBuiltinTools } from "../tools/builtins";
import { registerProvider } from "../providers/registry";
import { loadApiKey } from "../runtime/keyStore";
import { AgentDisclaimerDialog } from "./AgentDisclaimerDialog";

// Register tools once
let toolsRegistered = false;
function ensureToolsRegistered() {
  if (!toolsRegistered) {
    registerBuiltinTools();
    toolsRegistered = true;
  }
}

// Track which provider has been registered to avoid re-registration on every submit.
// Also track a simple hash of the API key so we re-register when the key changes.
let registeredProviderId: string | null = null;
let registeredKeyHash: string | null = null;

/** Simple hash to detect API key changes without storing the key in plaintext. */
function simpleKeyHash(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return String(hash);
}

async function ensureProviderRegistered(providerId: string, apiKey: string): Promise<void> {
  const keyHash = simpleKeyHash(apiKey);
  if (registeredProviderId === providerId && registeredKeyHash === keyHash) return;

  if (providerId === "anthropic") {
    const { createAnthropicProvider } = await import("../providers/anthropic");
    registerProvider(createAnthropicProvider(apiKey));
  } else if (providerId === "openai") {
    const { createOpenAiProvider } = await import("../providers/openai");
    registerProvider(createOpenAiProvider(apiKey));
  }

  registeredProviderId = providerId;
  registeredKeyHash = keyHash;
}

const DISCLAIMER_FLAG = "agent-disclaimer-accepted";

function isDisclaimerAccepted(): boolean {
  return localStorage.getItem(DISCLAIMER_FLAG) === "true";
}

function acceptDisclaimer(): void {
  localStorage.setItem(DISCLAIMER_FLAG, "true");
}

/**
 * Convert stored AgentMessages to AiMessages for the provider.
 */
function toAiMessages(messages: AgentMessage[]): AiMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export function AgentOverlay() {
  const isOpen = useAgentStore((s) => s.isOpen);
  const status = useAgentStore((s) => s.status);
  const toolActivity = useAgentStore((s) => s.toolActivity);
  const usage = useAgentStore((s) => s.usage);
  const settings = useAgentStore((s) => s.settings);
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

  // Focus input on open + check disclaimer
  useEffect(() => {
    if (isOpen) {
      ensureToolsRegistered();

      if (!disclaimerChecked) {
        setDisclaimerChecked(true);
        if (!isDisclaimerAccepted()) {
          setShowDisclaimer(true);
        }
      }

      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, disclaimerChecked]);

  // Global Escape handler
  useEffect(() => {
    if (!isOpen) return;
    function handleGlobalEscape(e: KeyboardEvent) {
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
      useAgentStore.getState().conversations.find((c) => c.id === convId)?.messages.slice(0, -1) ?? [],
    );

    void (async () => {
      const apiKey = await loadApiKey(settings.providerId);
      if (!apiKey) {
        useAgentStore.getState().appendText("Please configure your API key in Settings → AI Agent.");
        useAgentStore.getState().setStatus("error");
        return;
      }

      await ensureProviderRegistered(settings.providerId, apiKey);

      await runAgent({
        prompt: trimmed,
        providerId: settings.providerId,
        modelId: settings.modelId,
        apiKey,
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

  if (!isOpen) return null;

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
          <span className="text-sm font-medium text-rim-text">RIM Agent</span>
          <button
            type="button"
            onClick={handleNewConversation}
            className="ml-2 rounded p-0.5 text-rim-text-faint transition hover:text-rim-accent"
            title="New conversation"
            aria-label="New conversation"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span className="ml-auto text-[10px] text-rim-text-faint">
            {settings.providerId} / {settings.modelId.split("-").slice(0, 2).join("-")}
          </span>
          <button
            type="button"
            onClick={close}
            className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
            aria-label="Close agent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message list */}
        {hasMessages && (
          <div
            ref={outputRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
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
            <p className="text-sm text-rim-text-muted">
              Ask anything about your workspace
            </p>
            <p className="mt-1 text-xs text-rim-text-faint">
              Messages, channels, members — the agent can search and summarize for you.
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
              placeholder="Ask the agent..."
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

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2",
          isUser
            ? "bg-rim-accent/15 text-rim-text"
            : "bg-rim-void text-rim-text",
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
