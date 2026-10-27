import { useState, useRef, useMemo } from "react";

import { cn } from "../../../shared/ui/cn";
import { withClientLabel } from "../runtime/localCommands";
import type { CommandDefinition } from "../types";

const MAX_SUGGESTIONS = 12;

interface CommandIdInputProps {
  value: string;
  onChange: (commandId: string) => void;
  commands: CommandDefinition[] | undefined;
  placeholder?: string;
  className?: string;
  /** The error shown under the field once it is left, such as an unknown command id. */
  error?: string | null;
}

/**
 * Inline command picker with autocomplete dropdown.
 * Filters by id, title, and category. Shared across macro & pipeline editors.
 */
export function CommandIdInput({
  value,
  onChange,
  commands,
  placeholder = "Search commands...",
  className,
  error,
}: CommandIdInputProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectingRef = useRef(false);

  const filtered = useMemo(() => {
    if (!commands || !value.trim()) return commands ?? [];
    const q = value.toLowerCase();
    return commands.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
  }, [commands, value]);

  const showList = open && filtered.length > 0;
  const shownError = focused ? null : error;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          if (!selectingRef.current) setOpen(false);
        }}
        placeholder={placeholder}
        aria-invalid={shownError ? "true" : undefined}
        className={
          className ??
          "w-full rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
        }
      />
      {showList && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-rim-line bg-rim-panel shadow-lg">
          {filtered.slice(0, MAX_SUGGESTIONS).map((cmd) => (
            <button
              key={cmd.id}
              type="button"
              onMouseDown={() => {
                selectingRef.current = true;
              }}
              onClick={() => {
                selectingRef.current = false;
                onChange(cmd.id);
                setOpen(false);
                inputRef.current?.focus();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition",
                cmd.id === value
                  ? "bg-rim-accent/10 text-rim-text"
                  : "text-rim-text hover:bg-rim-void/50",
              )}
            >
              <span className="flex-1 truncate font-medium">{withClientLabel(cmd).title}</span>
              <span className="rounded bg-rim-void px-1.5 py-0.5 text-[10px] text-rim-text-faint">
                {cmd.category}
              </span>
              <span className="font-mono text-[10px] text-rim-text-faint">{cmd.id}</span>
            </button>
          ))}
        </div>
      )}
      {shownError && <p className="mt-1 text-xs text-rim-danger">{shownError}</p>}
    </div>
  );
}
