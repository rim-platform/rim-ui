import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { EmojiPicker } from "../../../shared/ui/EmojiPicker";
import { useCustomEmojis } from "../../emoji/api/useCustomEmojis";
import {
  CONTROL_CLASS,
  emptyPresetLabel,
  useFieldWorkspace,
  type ControlProps,
} from "./argumentControlParts";

/** The custom emoji name a `:name:` reaction names, or `null` for any other text. */
function shortcodeName(text: string): string | null {
  const match = /^:([^:\s]+):$/.exec(text.trim());
  return match ? match[1] : null;
}

/**
 * A reaction emoji: typed, or picked with the emoji picker, which gives a Unicode emoji or a
 * custom emoji of the workspace as `:name:`. A `:name:` that is not one of the workspace's custom
 * emoji is noted under the field, since the server takes it as a custom emoji's name.
 */
export function EmojiField(props: ControlProps) {
  const { value, onChange, controlId, describedBy, invalid, autoFocus, mode, argument } = props;
  const workspaceId = useFieldWorkspace(props.workspaceId);
  const { emojis, isLoading } = useCustomEmojis(workspaceId ?? null);
  const [pickerAt, setPickerAt] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const text = typeof value === "string" ? value : "";
  const name = shortcodeName(text);
  const unknownName = name !== null && !isLoading && !emojis.some((emoji) => emoji.name === name);
  const noteId = `${controlId}-note`;

  // Escape closes the open picker alone, not the dialog the form is in.
  useEffect(() => {
    if (!pickerAt) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPickerAt(null);
      buttonRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [pickerAt]);

  function openPicker() {
    const rect = buttonRef.current?.getBoundingClientRect();
    setPickerAt({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          id={controlId}
          type="text"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={mode === "preset" ? emptyPresetLabel(argument) : "👍 or :name:"}
          autoFocus={autoFocus}
          aria-describedby={
            [describedBy, unknownName ? noteId : null].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={invalid || undefined}
          className={cn(CONTROL_CLASS, "min-w-0 flex-1")}
        />
        <button
          ref={buttonRef}
          type="button"
          onClick={openPicker}
          aria-label="Choose an emoji"
          className="shrink-0 rounded-lg border border-rim-line p-2 text-rim-text-muted transition hover:text-rim-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
        >
          <SmilePlus className="h-4 w-4" />
        </button>
      </div>
      {unknownName && (
        <p id={noteId} className="text-xs text-rim-text-faint">
          No custom emoji is called :{name}: in this workspace
        </p>
      )}
      {pickerAt && (
        <EmojiPicker
          position={pickerAt}
          customEmojis={emojis}
          onSelect={(emoji) => {
            onChange(emoji);
            setPickerAt(null);
          }}
          onClose={() => setPickerAt(null)}
        />
      )}
    </div>
  );
}
