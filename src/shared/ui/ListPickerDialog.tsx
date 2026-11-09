import { useId, useMemo, useState } from "react";

import { cn } from "./cn";
import { Dialog } from "./Dialog";

/** One choice in a {@link ListPickerDialog}. */
export interface PickerItem {
  id: string;
  label: string;
  /** A second line under the label; searched with it. */
  detail?: string;
}

interface ListPickerDialogProps {
  title: string;
  items: readonly PickerItem[];
  /** Whether the choices are still loading. */
  loading?: boolean;
  /** What to say when there is nothing to choose. */
  emptyText: string;
  /** An error that stopped the choices from loading. */
  error?: string | null;
  /** The choice a typed query stands for, offered after the matches; `null` offers none. */
  custom?: (query: string) => PickerItem | null;
  onPick: (item: PickerItem) => void;
  onClose: () => void;
}

/**
 * A dialog that lists choices under a search field: typing narrows them, the arrow keys move
 * the highlight, Enter picks it and Escape cancels.
 */
export function ListPickerDialog({
  title,
  items,
  loading = false,
  emptyText,
  error = null,
  custom,
  onPick,
  onClose,
}: ListPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? items.filter((item) => `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(needle))
      : [...items];
    const typed = needle && custom ? custom(query.trim()) : null;
    return typed ? [...matches, typed] : matches;
  }, [items, query, custom]);
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(current + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[current];
      if (item) onPick(item);
    }
  }

  return (
    <Dialog open title={title} onClose={onClose} maxWidth="max-w-md">
      <input
        type="text"
        role="combobox"
        aria-label="Search"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown[current] ? `${listId}-${current}` : undefined}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Type to search"
        className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent/40"
      />
      {loading && <p className="mt-3 text-sm text-rim-text-muted">Loading…</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-rim-danger">
          {error}
        </p>
      )}
      {!loading && !error && shown.length === 0 && (
        <p className="mt-3 text-sm text-rim-text-muted">
          {query.trim() ? "Nothing matches." : emptyText}
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={title}
        className="mt-2 max-h-72 space-y-0.5 overflow-y-auto"
      >
        {shown.map((item, index) => (
          <li
            key={item.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setActive(index)}
            onClick={() => onPick(item)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-2",
              index === current ? "bg-rim-accent/15" : "hover:bg-rim-panel",
            )}
          >
            <span className="block truncate text-sm text-rim-text">{item.label}</span>
            {item.detail && (
              <span className="block truncate text-xs text-rim-text-muted">{item.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
