import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useResolvedKeybinds } from "../api/useKeybinds";

/**
 * Returns the keystroke string for a command ID from resolvedKeybinds.
 * Optionally filters by presetArgs to find channel-specific keybinds.
 */
export function useKeybindLabel(
  commandId: string,
  presetArgs?: Record<string, unknown>,
): string | null {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { data: keybinds } = useResolvedKeybinds(workspaceId ?? undefined);

  if (!keybinds) return null;

  const match = keybinds.find((kb) => {
    if (kb.commandId !== commandId || !kb.isEnabled) return false;
    if (!presetArgs) return true;
    // Match presetArgs — check that every key in the filter matches the keybind's presetArgs
    const kbArgs = kb.presetArgs as Record<string, unknown> | null;
    if (!kbArgs) return false;
    return Object.entries(presetArgs).every(
      ([key, value]) => kbArgs[key] === value,
    );
  });

  return match?.keystroke ?? null;
}
