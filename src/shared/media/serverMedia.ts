/**
 * Images and media the server stores (avatars, attachments) as `src` values the page can show.
 * The web app is served by its server and loads them directly. The desktop app runs on its own
 * origin, and its content security policy loads images and media only from itself, `data:` and
 * `blob:`, so it downloads a server file with the session and shows it as an object URL. One
 * download serves every element showing the same file; its object URL is revoked a while after
 * the last of them unmounts.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { getApiOrigin } from "../../core/graphql/config";
import { detectPlatform } from "../../core/runtime/runtime";

/** How long an object URL nobody shows stays cached before it is revoked. */
const RELEASE_DELAY_MS = 30_000;

/**
 * A server file URL made absolute: a path such as `/api/files/avatars/<id>/avatar.png` is
 * resolved against {@link getApiOrigin}; anything else (an absolute URL, `blob:`, `data:`) is
 * returned unchanged.
 */
export function resolveServerUrl(url: string): string {
  if (url.startsWith("/") && !url.startsWith("//")) return `${getApiOrigin()}${url}`;
  return url;
}

/** Whether `url` (absolute) names a file on the server's API origin. */
export function isOnApiOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(getApiOrigin()).origin;
  } catch {
    return false;
  }
}

/** Whether `url` (absolute) is shown through a downloaded object URL rather than directly. */
export function loadsAsBlob(url: string): boolean {
  return detectPlatform() === "desktop" && isOnApiOrigin(url);
}

/** One downloaded file and the elements showing it. */
interface Entry {
  url: string;
  promise: Promise<string | null>;
  /** The object URL once downloaded; `null` before, and when the download failed. */
  objectUrl: string | null;
  refs: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let generation = 0;

async function download(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

function acquire(url: string): Entry {
  let entry = entries.get(url);
  if (!entry) {
    const created: Entry = {
      url,
      promise: Promise.resolve(null),
      objectUrl: null,
      refs: 0,
      releaseTimer: null,
    };
    created.promise = download(url).then((blob) => {
      if (!blob) return null;
      created.objectUrl = URL.createObjectURL(blob);
      // Nothing showed it before the download finished: drop it right away.
      if (created.refs === 0 && created.releaseTimer === null) drop(created);
      return created.objectUrl;
    });
    entries.set(url, created);
    entry = created;
  }
  if (entry.releaseTimer !== null) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.refs += 1;
  return entry;
}

function drop(entry: Entry): void {
  if (entries.get(entry.url) === entry) entries.delete(entry.url);
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  entry.objectUrl = null;
}

function release(entry: Entry): void {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.releaseTimer = setTimeout(() => {
    entry.releaseTimer = null;
    if (entry.refs === 0) drop(entry);
  }, RELEASE_DELAY_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function currentGeneration(): number {
  return generation;
}

/**
 * Download `url` again wherever it is shown, for a file the server replaced under the same
 * path (an avatar uploaded anew). Does nothing on the web, where the browser loads it.
 *
 * @param url - The file's URL as the server names it, relative or absolute.
 */
export function refreshServerMedia(url: string): void {
  const resolved = resolveServerUrl(url);
  const entry = entries.get(resolved);
  if (!entry) return;
  // Elements still showing the old copy keep it until they release it.
  entries.delete(resolved);
  if (entry.refs === 0) drop(entry);
  generation += 1;
  for (const listener of listeners) listener();
}

/** A server file to show: its `src` once there is one, and whether its download failed. */
export interface ServerMedia {
  /** The `src`, or `null` with no URL, before the download arrived, or when it failed. */
  src: string | null;
  /** Whether the desktop app's download of the file failed. */
  failed: boolean;
}

/**
 * A server file to show: on the web, the URL as given, which the page's own server resolves; on
 * the desktop, an object URL of the downloaded file once it has arrived. An absolute URL on
 * another origin is returned as given on both.
 *
 * @param url - The file's URL as the server names it, relative or absolute; `null` for none.
 * @param enabled - Whether to download it now; while `false` the desktop app shows nothing.
 */
export function useServerMedia(url: string | null | undefined, enabled = true): ServerMedia {
  const resolved = url ? resolveServerUrl(url) : null;
  const viaBlob = resolved !== null && loadsAsBlob(resolved);
  const active = viaBlob && enabled;
  const version = useSyncExternalStore(subscribe, currentGeneration, currentGeneration);
  const [loaded, setLoaded] = useState<{ url: string; version: number; src: string | null }>();

  useEffect(() => {
    if (!active || !resolved) return;
    let current = true;
    const entry = acquire(resolved);
    void entry.promise.then((src) => {
      if (current) setLoaded({ url: resolved, version, src });
    });
    return () => {
      current = false;
      release(entry);
    };
  }, [active, resolved, version]);

  if (!url || !resolved) return { src: null, failed: false };
  if (!viaBlob) return { src: url, failed: false };
  if (!active) return { src: null, failed: false };
  if (loaded && loaded.url === resolved && loaded.version === version) {
    return { src: loaded.src, failed: loaded.src === null };
  }
  return { src: entries.get(resolved)?.objectUrl ?? null, failed: false };
}

/**
 * The `src` to show a server file with, as {@link useServerMedia} gives it.
 *
 * @param url - The file's URL as the server names it, relative or absolute; `null` for none.
 * @returns The `src`, or `null` with no URL, before the download arrived, or when it failed.
 */
export function useServerMediaUrl(url: string | null | undefined): string | null {
  return useServerMedia(url).src;
}

/** The URLs a {@link useServerMediaUrls} key joins. */
function urlsOf(key: string): string[] {
  return key === "" ? [] : key.split("\n");
}

/**
 * The `src` of each server file in `urls` that can be shown now, keyed by the URL as given:
 * on the web each URL as given; on the desktop the object URL of each download that has
 * arrived. A pending or failed download has no entry.
 *
 * @param urls - The files' URLs as the server names them, relative or absolute.
 * @returns The `src` of each file that can be shown, by its URL as given.
 */
export function useServerMediaUrls(urls: readonly string[]): ReadonlyMap<string, string> {
  const key = urls.join("\n");
  const version = useSyncExternalStore(subscribe, currentGeneration, currentGeneration);
  const [loaded, setLoaded] = useState<{
    key: string;
    version: number;
    srcs: Map<string, string>;
  }>();

  useEffect(() => {
    let current = true;
    const acquired: Entry[] = [];
    for (const url of urlsOf(key)) {
      const resolved = resolveServerUrl(url);
      if (!loadsAsBlob(resolved)) continue;
      const entry = acquire(resolved);
      acquired.push(entry);
      void entry.promise.then((src) => {
        if (!current || src === null) return;
        setLoaded((prev) => {
          const srcs = new Map(prev?.key === key && prev.version === version ? prev.srcs : []);
          srcs.set(url, src);
          return { key, version, srcs };
        });
      });
    }
    return () => {
      current = false;
      for (const entry of acquired) release(entry);
    };
  }, [key, version]);

  return useMemo(() => {
    const fresh = loaded?.key === key && loaded.version === version ? loaded.srcs : null;
    const srcs = new Map<string, string>();
    for (const url of urlsOf(key)) {
      const resolved = resolveServerUrl(url);
      const src = !loadsAsBlob(resolved)
        ? url
        : (fresh?.get(url) ?? entries.get(resolved)?.objectUrl ?? null);
      if (src) srcs.set(url, src);
    }
    return srcs;
  }, [key, version, loaded]);
}
