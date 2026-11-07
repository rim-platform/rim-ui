import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { TargetPickerKind } from "../state/useCommandStore";
import {
  useChannelTargets,
  useDirectTargets,
  useJoinableTargets,
  useWorkspaceTargets,
  type PickerTarget,
  type Targets,
} from "./paletteTargets";

export type { PickerTarget } from "./paletteTargets";

interface PickerText {
  title: string;
  placeholder: string;
  empty: string;
}

const TEXT: Record<TargetPickerKind, PickerText> = {
  channel: {
    title: "Go to channel",
    placeholder: "Search channels and messages...",
    empty: "No channels or messages.",
  },
  direct: {
    title: "Go to direct message",
    placeholder: "Search direct messages...",
    empty: "No direct messages.",
  },
  workspace: {
    title: "Switch workspace",
    placeholder: "Search workspaces...",
    empty: "No other workspaces",
  },
  joinableChannel: {
    title: "Join channel",
    placeholder: "Search channels...",
    empty: "No channels to join",
  },
};

interface PaletteTargetPickerProps {
  kind: TargetPickerKind;
  /** Called with the target the person chose. */
  onPick: (target: PickerTarget) => void;
  /** Called to return to the command list. */
  onBack: () => void;
}

/**
 * The command palette's second step: a titled, searchable list of the targets a command runs
 * on. Arrow keys move, Enter or a click picks, Escape returns to the command list.
 */
export function PaletteTargetPicker(props: PaletteTargetPickerProps) {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const inDirectSpace = useIsDirectSpace(workspaceId);
  // A direct space has no channels: its conversations are the direct messages.
  const source = props.kind === "channel" && inDirectSpace ? "direct" : props.kind;
  switch (source) {
    case "channel":
      return <TargetList key={source} {...props} useTargets={useChannelTargets} />;
    case "direct":
      return <TargetList key={source} {...props} useTargets={useDirectTargets} />;
    case "workspace":
      return <TargetList key={source} {...props} useTargets={useWorkspaceTargets} />;
    case "joinableChannel":
      return <TargetList key={source} {...props} useTargets={useJoinableTargets} />;
  }
}

function TargetList({
  kind,
  onPick,
  onBack,
  useTargets,
}: PaletteTargetPickerProps & { useTargets: () => Targets }) {
  const text = TEXT[kind];
  const { items, isPending } = useTargets();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((t) => t.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const row = listRef.current?.querySelectorAll("[data-target-item]")[selectedIndex];
    (row as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, shown.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        if (shown[selectedIndex]) onPick(shown[selectedIndex]);
        break;
      case "Escape":
        event.preventDefault();
        onBack();
        break;
      default:
        return;
    }
    event.stopPropagation();
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <div className="border-b border-rim-line px-4 pt-3 text-xs font-medium text-rim-text-muted">
        {text.title}
      </div>
      <div className="flex items-center gap-2 border-b border-rim-line px-4 py-3">
        <Search className="h-4 w-4 text-rim-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={text.placeholder}
          aria-label={text.title}
          className="flex-1 bg-transparent text-sm text-rim-text outline-none placeholder:text-rim-text-muted"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={text.title}
        className="max-h-80 overflow-y-auto p-1"
      >
        {isPending ? (
          <div className="px-4 py-8 text-center text-sm text-rim-text-muted">Loading...</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-rim-text-muted">
            {items.length === 0 ? text.empty : "No matches."}
          </div>
        ) : (
          shown.map((target, index) => (
            <button
              key={`${target.serverId}:${target.id}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              data-target-item
              className={cn(
                "flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors",
                index === selectedIndex
                  ? "bg-rim-accent/10 text-rim-text"
                  : "text-rim-text-muted hover:bg-rim-void/50",
              )}
              onClick={() => onPick(target)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="truncate">{target.label}</span>
            </button>
          ))
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-rim-line px-4 py-2 text-[11px] text-rim-text-muted">
        <span>
          <kbd className="font-mono">&#8593;&#8595;</kbd> navigate
        </span>
        <span>
          <kbd className="font-mono">Enter</kbd> select
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> back
        </span>
      </div>
    </div>
  );
}
