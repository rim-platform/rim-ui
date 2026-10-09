import { runtimeKind, type PluginInfo } from "../types";

/** How a plugin runs, in a few words for host chrome. */
export function kindLabel(plugin: Pick<PluginInfo, "runtime_kind">): string {
  return runtimeKind(plugin) === "WebSandboxed" ? "Sandboxed" : "Runs on this computer";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Whether a plugin is signed and where it came from, as Settings and panel chrome show it. */
export function trustBadge(plugin: Pick<PluginInfo, "source">): string {
  const source = plugin.source;
  switch (source?.kind) {
    case "link":
      return `Unsigned · installed from a link (${hostOf(source.url)})`;
    case "git":
      return `Unsigned · installed from git (${hostOf(source.url)})`;
    case "local":
      return "Unsigned · installed from a folder";
    case "registry":
      return "From the workspace registry";
    default:
      return "Unsigned";
  }
}
