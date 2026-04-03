import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { logger } from "../../../core/logger";
import type { PluginEvent } from "../types";

type PluginEventHandler = (event: PluginEvent) => void;

const handlers = new Set<PluginEventHandler>();

let unlisten: UnlistenFn | null = null;
let listenerCount = 0;

function handleEvent(event: PluginEvent) {
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      logger.warn("[RIM:Plugin] Event handler error:", err);
    }
  }
}

async function startListening() {
  if (unlisten) return;
  try {
    unlisten = await listen<PluginEvent>("plugin-event", (e) => {
      handleEvent(e.payload);
    });
  } catch {
    // Tauri event system not available (web mode) — no-op
  }
}

function stopListening() {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

export function onPluginEvent(handler: PluginEventHandler): () => void {
  handlers.add(handler);
  listenerCount++;
  if (listenerCount === 1) {
    startListening();
  }
  return () => {
    handlers.delete(handler);
    listenerCount--;
    if (listenerCount === 0) {
      stopListening();
    }
  };
}

export function usePluginEvents() {
  const qc = useQueryClient();

  useEffect(() => {
    return onPluginEvent((event) => {
      logger.debug("[RIM:Plugin] Event:", event.kind, event.plugin_id);

      switch (event.kind) {
        case "plugin_started":
        case "plugin_stopped":
        case "plugin_crashed":
        case "plugin_timeout":
          qc.invalidateQueries({ queryKey: queryKeys.plugins() });
          break;
        case "plugin_log":
          // Future: route to plugin console
          break;
      }
    });
  }, [qc]);
}
