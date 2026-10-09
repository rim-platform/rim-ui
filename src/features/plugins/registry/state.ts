// The registry dialogs this page shows: the install dialog, updates waiting for the person, and
// plugins whose entries their workspace removed. "Not now" on a required plugin is remembered
// per browser profile, by server, plugin id and statement hash.

import { create } from "zustand";

import type { PluginInfo } from "../types";
import type { UpdatePlan } from "./model";
import type { VerifiedEntry } from "./verify";

/** An update that waits behind a prompt: what is new, and the entry it installs. */
export interface UpdatePrompt {
  plugin: PluginInfo;
  check: VerifiedEntry;
  plan: UpdatePlan;
  workspaceName: string;
}

/** A plugin stopped because its workspace removed its entry, waiting for "Remove" or "Keep". */
export interface RemovalPrompt {
  plugin: PluginInfo;
  workspaceName: string;
}

interface RegistryUiState {
  /** The entry whose install dialog is open. */
  installing: { serverId: string; pluginId: string } | null;
  updates: UpdatePrompt[];
  removals: RemovalPrompt[];
  openInstall: (serverId: string, pluginId: string) => void;
  closeInstall: () => void;
  promptUpdate: (prompt: UpdatePrompt) => void;
  dropUpdate: (pluginId: string) => void;
  promptRemoval: (prompt: RemovalPrompt) => void;
  dropRemoval: (pluginId: string) => void;
}

export const useRegistryStore = create<RegistryUiState>((set) => ({
  installing: null,
  updates: [],
  removals: [],
  openInstall: (serverId, pluginId) => set({ installing: { serverId, pluginId } }),
  closeInstall: () => set({ installing: null }),
  promptUpdate: (prompt) =>
    set((s) => ({
      updates: [...s.updates.filter((u) => u.plugin.plugin_id !== prompt.plugin.plugin_id), prompt],
    })),
  dropUpdate: (pluginId) =>
    set((s) => ({ updates: s.updates.filter((u) => u.plugin.plugin_id !== pluginId) })),
  promptRemoval: (prompt) =>
    set((s) => ({
      removals: [
        ...s.removals.filter((r) => r.plugin.plugin_id !== prompt.plugin.plugin_id),
        prompt,
      ],
    })),
  dropRemoval: (pluginId) =>
    set((s) => ({ removals: s.removals.filter((r) => r.plugin.plugin_id !== pluginId) })),
}));

const NOT_NOW_KEY = "rim.registry.notNow";

/** The key a "Not now" is remembered under. */
export function notNowKey(serverId: string, pluginId: string, statementSha256: string): string {
  return `${serverId}/${pluginId}/${statementSha256}`;
}

function readNotNow(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NOT_NOW_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function isNotNow(key: string): boolean {
  return readNotNow().includes(key);
}

/** Remember "Not now" for these entries; the newest 500 are kept. */
export function rememberNotNow(keys: readonly string[]): void {
  const known = readNotNow().filter((k) => !keys.includes(k));
  try {
    localStorage.setItem(NOT_NOW_KEY, JSON.stringify([...known, ...keys].slice(-500)));
  } catch {
    // Storage unavailable: the dialog asks again next time.
  }
}

/** What this page acted on and listed, across workspace switches, so a refetch never asks twice. */
export const registrySession = {
  /** Updates and removals already acted on. */
  handled: new Set<string>(),
  /** Required entries already listed in the required plugins dialog. */
  listed: new Set<string>(),
};

/** Forget what this page acted on and listed; for tests. */
export function resetRegistrySession(): void {
  registrySession.handled.clear();
  registrySession.listed.clear();
}
