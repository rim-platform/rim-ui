// Panel state of web plugins, kept by the host between a plugin frame, which
// sets it with `rim.ui.update_panel`, and its panel frames, which are sent it as
// `panel.state_update`. The desktop's `PanelRelay` does the same for local
// processes: replace or shallow merge, at most 1 MiB per plugin, and `null` to
// open panels when the plugin stops.

/** Largest total panel state of one plugin, in bytes of JSON. */
export const MAX_PANEL_STATE_BYTES = 1024 * 1024;

/** A panel's whole state after a change; `null` once its plugin stopped. */
export interface PanelStateChange {
  pluginId: string;
  panelId: string;
  state: unknown;
}

export class PanelStateTooLargeError extends Error {
  constructor(bytes: number) {
    super(`state size exceeds limit (${bytes} bytes, max ${MAX_PANEL_STATE_BYTES})`);
    this.name = "PanelStateTooLargeError";
  }
}

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? "").length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WebPanelRelay {
  private readonly states = new Map<string, Map<string, unknown>>();
  private readonly listeners = new Set<(change: PanelStateChange) => void>();

  /** Every change from now on, in order. Returns the unsubscribe function. */
  subscribe(listener: (change: PanelStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(pluginId: string, panelId: string, state: unknown): void {
    for (const listener of this.listeners) listener({ pluginId, panelId, state });
  }

  private total(pluginId: string): number {
    let bytes = 0;
    for (const state of this.states.get(pluginId)?.values() ?? []) bytes += jsonBytes(state);
    return bytes;
  }

  /** Replace a panel's state. */
  setState(pluginId: string, panelId: string, state: unknown): void {
    // Counted against everything the plugin holds, as the desktop does.
    const bytes = this.total(pluginId) + jsonBytes(state);
    if (bytes > MAX_PANEL_STATE_BYTES) throw new PanelStateTooLargeError(bytes);
    let panels = this.states.get(pluginId);
    if (!panels) {
      panels = new Map();
      this.states.set(pluginId, panels);
    }
    panels.set(panelId, state);
    this.publish(pluginId, panelId, state);
  }

  /** Merge `patch`'s top-level keys into a panel's state; returns the merged state. */
  patchState(pluginId: string, panelId: string, patch: unknown): unknown {
    let panels = this.states.get(pluginId);
    if (!panels) {
      panels = new Map();
      this.states.set(pluginId, panels);
    }
    const current = panels.has(panelId) ? panels.get(panelId) : {};
    const merged = isRecord(current) && isRecord(patch) ? { ...current, ...patch } : patch;
    panels.set(panelId, merged);
    const bytes = this.total(pluginId);
    if (bytes > MAX_PANEL_STATE_BYTES) {
      panels.delete(panelId);
      throw new PanelStateTooLargeError(bytes);
    }
    this.publish(pluginId, panelId, merged);
    return merged;
  }

  /** A panel's state, or `null` when it has none. */
  getState(pluginId: string, panelId: string): unknown {
    return this.states.get(pluginId)?.get(panelId) ?? null;
  }

  /** Forget a stopped plugin's state and tell its open panels. */
  cleanupPlugin(pluginId: string): void {
    const panels = this.states.get(pluginId);
    this.states.delete(pluginId);
    for (const panelId of panels?.keys() ?? []) this.publish(pluginId, panelId, null);
  }
}
