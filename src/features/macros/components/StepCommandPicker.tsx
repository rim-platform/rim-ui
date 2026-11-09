import { useId, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import type { CommandDefinition } from "../../commands/types";

export interface StepCommandPickerProps {
  /** The command the step runs; empty while none is picked. */
  value: string;
  onChange: (commandId: string) => void;
  /** The commands a step may run. */
  commands: readonly CommandDefinition[];
  /** What the picker is for, such as "Step 2 command". */
  label: string;
}

function matches(command: CommandDefinition, query: string): boolean {
  if (!query) return true;
  return [command.title, command.id, command.description, command.category].some((text) =>
    text.toLowerCase().includes(query),
  );
}

/**
 * The command a macro step runs, picked from a searchable list grouped by category, each with
 * its description. The search matches titles, ids, descriptions and categories.
 */
export function StepCommandPicker({ value, onChange, commands, label }: StepCommandPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const selected = commands.find((command) => command.id === value);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands
      .filter((command) => matches(command, q))
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }, [commands, query]);

  function pick(commandId: string) {
    onChange(commandId);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = results[active];
      if (command) pick(command.id);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          setActive(0);
          setOpen(true);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-rim-line bg-rim-panel px-3 py-1.5 text-left text-sm text-rim-text transition hover:border-rim-accent"
      >
        <span className={cn("truncate", !value && "text-rim-text-muted")}>
          {selected
            ? showInvisibleCharacters(selected.title)
            : value
              ? showInvisibleCharacters(value)
              : "Choose a command"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-rim-accent bg-rim-panel" data-owns-escape>
      <div className="flex items-center gap-2 border-b border-rim-line px-3 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          aria-label={`Search commands for ${label.toLowerCase()}`}
          aria-controls={listId}
          placeholder="Search commands…"
          className="min-w-0 flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
        />
      </div>
      <div id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
        {results.length === 0 && (
          <p className="px-3 py-2 text-xs text-rim-text-muted">No command matches.</p>
        )}
        {results.map((command, index) => {
          const header =
            index === 0 || results[index - 1].category !== command.category
              ? command.category
              : null;
          return (
            <div key={command.id}>
              {header && (
                <div className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-rim-text-faint">
                  {showInvisibleCharacters(header)}
                </div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={command.id === value}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(command.id)}
                className={cn(
                  "block w-full px-3 py-1.5 text-left",
                  index === active ? "bg-rim-panel-soft" : "hover:bg-white/5",
                )}
              >
                <span className="block text-sm text-rim-text">
                  {showInvisibleCharacters(command.title)}
                </span>
                {command.description && (
                  <span className="block truncate text-xs text-rim-text-muted">
                    {showInvisibleCharacters(command.description)}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
