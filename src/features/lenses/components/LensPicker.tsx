import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, Plus, Pencil, Trash2, Share2, X } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { Z } from "../../../shared/ui/zIndex";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useLenses, useDeleteLensMutation } from "../api/useLenses";
import type { ChannelLens } from "../api/useLenses";
import { useLensStore } from "../state/useLensStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { LensEditor } from "./LensEditor";
import { toast } from "../../../shared/toast";

interface LensPickerProps {
  serverId: string;
  conversationId: string;
}

export function LensPicker({ serverId, conversationId }: LensPickerProps) {
  const pickerOpen = useLensStore((s) => s.lensPickerOpen);
  const setPickerOpen = useLensStore((s) => s.setLensPickerOpen);
  const activeLensId = useLensStore((s) => s.activeLenses[conversationId] ?? null);
  const setActiveLens = useLensStore((s) => s.setActiveLens);

  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <HoverTooltip content={<span className="text-xs text-rim-text whitespace-nowrap">Channel lenses</span>}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          aria-label="Channel lenses"
          className={cn(
            "rounded-lg p-1.5 transition",
            activeLensId
              ? "bg-rim-accent/10 text-rim-accent hover:bg-rim-accent/20"
              : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </HoverTooltip>

      {pickerOpen && (
        <LensPickerDropdown
          serverId={serverId}
          conversationId={conversationId}
          activeLensId={activeLensId}
          onSelect={(lensId) => {
            setActiveLens(conversationId, lensId);
            setPickerOpen(false);
          }}
          onClear={() => {
            setActiveLens(conversationId, null);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
}

// --- Dropdown ---

interface LensPickerDropdownProps {
  serverId: string;
  conversationId: string;
  activeLensId: string | null;
  onSelect: (lensId: string) => void;
  onClear: () => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

function LensPickerDropdown({
  serverId,
  conversationId,
  activeLensId,
  onSelect,
  onClear,
  onClose,
  triggerRef,
}: LensPickerDropdownProps) {
  const { data: lenses, isPending } = useLenses(serverId, conversationId);
  const deleteLens = useDeleteLensMutation();
  const currentUserId = useAuthStore((s) => s.session?.userId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingLens, setEditingLens] = useState<ChannelLens | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Position below trigger
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - 260),
    });
  }, [triggerRef]);

  // Focus menu
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  // Close on click outside (but not if clicking inside a dialog/portal)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Skip if click is inside the menu or the trigger
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      // Skip if click is inside a dialog (portaled outside the menu)
      const dialog = (target as HTMLElement).closest?.("[role='dialog'], [data-dialog]");
      if (dialog) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, triggerRef]);

  const handleDelete = useCallback(
    async (lens: ChannelLens) => {
      try {
        await deleteLens.mutateAsync({ lensId: lens.id, serverId, conversationId });
        if (activeLensId === lens.id) {
          onClear();
        }
        toast.success("Lens deleted");
      } catch {
        toast.error("Failed to delete lens");
      }
    },
    [deleteLens, serverId, conversationId, activeLensId, onClear],
  );

  // Build item list for keyboard nav
  const itemCount = (lenses?.length ?? 0) + (activeLensId ? 1 : 0) + 1; // +1 for "Create" at bottom

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((i) => (i + 1) % itemCount);
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((i) => (i - 1 + itemCount) % itemCount);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Enter":
        e.preventDefault();
        handleEnterOnFocused();
        break;
    }
  }

  function handleEnterOnFocused() {
    let idx = 0;
    if (activeLensId) {
      if (focusedIndex === 0) {
        onClear();
        return;
      }
      idx = focusedIndex - 1;
    } else {
      idx = focusedIndex;
    }

    if (lenses && idx < lenses.length) {
      onSelect(lenses[idx].id);
    } else {
      // Create new
      setEditingLens(null);
      setEditorOpen(true);
    }
  }

  let itemIndex = 0;

  return createPortal(
    <>
      <div
        ref={menuRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="fixed min-w-[260px] max-w-[320px] rounded-lg border border-rim-line bg-rim-panel py-1 shadow-xl outline-none"
        style={{ top: position.top, left: position.left, zIndex: Z.DROPDOWN }}
      >
        {/* Clear active lens */}
        {activeLensId && (
          <button
            type="button"
            onClick={onClear}
            onMouseEnter={() => setFocusedIndex(0)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
              focusedIndex === 0
                ? "bg-rim-accent/10 text-rim-text"
                : "text-rim-text-muted hover:bg-white/5",
            )}
          >
            <X className="h-3.5 w-3.5" />
            <span>Clear lens</span>
          </button>
        )}

        {/* Lens list */}
        {isPending ? (
          <div className="px-3 py-2 text-xs text-rim-text-muted">Loading...</div>
        ) : lenses && lenses.length > 0 ? (
          lenses.map((lens) => {
            const currentIndex = activeLensId ? itemIndex + 1 : itemIndex;
            itemIndex++;
            const isOwn = lens.createdBy === currentUserId;
            const isActive = lens.id === activeLensId;

            return (
              <div
                key={lens.id}
                onMouseEnter={() => setFocusedIndex(currentIndex)}
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5 transition-colors",
                  focusedIndex === currentIndex
                    ? "bg-rim-accent/10"
                    : "hover:bg-white/5",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(lens.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-sm text-rim-text"
                >
                  <span className={cn("truncate", isActive && "font-medium text-rim-accent")}>
                    {lens.name}
                  </span>
                  {lens.isShared && (
                    <Share2 className="h-3 w-3 flex-shrink-0 text-rim-text-faint" />
                  )}
                </button>
                {isOwn && (
                  <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingLens(lens);
                        setEditorOpen(true);
                      }}
                      aria-label={`Edit ${lens.name}`}
                      className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-text"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(lens);
                      }}
                      aria-label={`Delete ${lens.name}`}
                      className="rounded p-0.5 text-rim-text-faint transition hover:text-rim-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="px-3 py-2 text-xs text-rim-text-muted">No lenses yet</div>
        )}

        {/* Separator */}
        <div className="my-1 border-t border-rim-line" />

        {/* Create new */}
        <button
          type="button"
          onClick={() => {
            setEditingLens(null);
            setEditorOpen(true);
          }}
          onMouseEnter={() => setFocusedIndex(itemCount - 1)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
            focusedIndex === itemCount - 1
              ? "bg-rim-accent/10 text-rim-accent"
              : "text-rim-accent/70 hover:bg-white/5 hover:text-rim-accent",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Create lens</span>
        </button>
      </div>

      {editorOpen && (
        <LensEditor
          open={editorOpen}
          onClose={() => {
            setEditorOpen(false);
            setEditingLens(null);
          }}
          serverId={serverId}
          conversationId={conversationId}
          existingLens={editingLens}
        />
      )}
    </>,
    document.body,
  );
}
