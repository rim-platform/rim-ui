import type { HostToPluginMessage } from "./pluginBridge";

const THEME_VARIABLES = [
  "--color-rim-void",
  "--color-rim-panel",
  "--color-rim-panel-soft",
  "--color-rim-line",
  "--color-rim-accent",
  "--color-rim-accent-strong",
  "--color-rim-warm",
  "--color-rim-danger",
  "--color-rim-success",
  "--color-rim-text",
  "--color-rim-text-muted",
  "--color-rim-text-faint",
] as const;

export function getThemeVariables(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  for (const name of THEME_VARIABLES) {
    variables[name] = styles.getPropertyValue(name).trim();
  }
  return variables;
}

export function createThemeChangeMessage(): HostToPluginMessage {
  return {
    type: "theme.changed",
    variables: getThemeVariables(),
  };
}

let observer: MutationObserver | null = null;
const listeners = new Set<(msg: HostToPluginMessage) => void>();

function startObserving() {
  if (observer) return;
  observer = new MutationObserver(() => {
    const msg = createThemeChangeMessage();
    for (const listener of listeners) {
      listener(msg);
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
}

function stopObserving() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

export function onThemeChange(listener: (msg: HostToPluginMessage) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startObserving();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopObserving();
  };
}
