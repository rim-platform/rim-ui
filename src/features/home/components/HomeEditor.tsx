import { useEffect, useRef, useState, type KeyboardEventHandler, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS as DndCss } from "@dnd-kit/utilities";
import { Ellipsis, GripVertical, Maximize2, Minimize2, X } from "lucide-react";

import { hostDialogOpen } from "../../../shared/ui/hostDialogs";
import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { Dialog } from "../../../shared/ui/Dialog";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";
import { useShellWidth } from "../../../shell/hooks/useShellWidth";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { resetHomeLayout, saveHomeLayout } from "../api/homeLayoutApi";
import { BOX_KINDS, boxKind, boxName, settingsNeedFixing } from "../boxes/registry";
import { useBoxTitle } from "../boxes/useBoxTitle";
import { BoxSettingsDialog } from "./BoxSettingsDialog";
import {
  addBox,
  MAX_BOXES,
  moveBox,
  moveBoxTo,
  removeBox,
  sameLayout,
  setBoxSettings,
  setBoxWidth,
  type HomeBox,
  type HomeLayoutDoc,
} from "../layout/homeLayout";
import { useHomeEditStore } from "../state/useHomeEditStore";
import { useHomeHiddenStore } from "../state/useHomeLayoutStore";
import { boxLimit, GRID_CLASS, widthClass } from "../boxes/boxPlacement";

type BoxAction = "reorder" | "width" | "more" | "remove";

/** Whose settings are open: a box about to be added, or a box of the layout. */
type SettingsTarget = { adding: string } | { boxId: string } | null;

const CONTROL_CLASS =
  "inline-flex h-7 min-w-7 items-center justify-center rounded border border-rim-line px-1.5 text-xs text-rim-text-muted transition hover:text-rim-text aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:text-rim-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";

type Confirm = "discard" | "reset" | { remove: string } | null;

/**
 * Home being edited: each box can be dragged to another place, by its header or, from the
 * keyboard, by its Reorder handle, and its More menu moves it up or down, opens its settings or
 * removes it. Each can be half or full width. Add a box lists the kinds this app knows. Done saves the layout to the account, Cancel or Escape
 * drops the changes, and Reset to default deletes the saved layout on every device.
 *
 * @param saved - The layout Home showed when editing began, to tell whether anything changed.
 */
export function HomeEditor({ draft, saved }: { draft: HomeLayoutDoc; saved: HomeLayoutDoc }) {
  const update = useHomeEditStore((s) => s.update);
  const stop = useHomeEditStore((s) => s.stop);
  const hidden = useHomeHiddenStore((s) => s.hidden);
  const showHere = useHomeHiddenStore((s) => s.show);
  const narrow = useShellWidth() === "narrow";
  const [announcement, setAnnouncement] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [resetting, setResetting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ id: string; action: BoxAction } | null>(null);
  const [settingsFor, setSettingsFor] = useState<SettingsTarget>(null);
  // Fix settings on Home opens the editor at that box's settings.
  const openedAtBox = useHomeEditStore((s) => s.settingsBoxId);
  const closeOpenedAt = useHomeEditStore((s) => s.closeSettings);
  const settingsTarget: SettingsTarget =
    settingsFor ?? (openedAtBox ? { boxId: openedAtBox } : null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const changed = !sameLayout(draft, saved);
  // The names the boxes show, which the drag announcements use.
  const names = useRef(new Map<string, string>());
  // A drag is under way: Escape then cancels the drag, not the edit.
  const dragging = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const shown = draft.boxes.filter((box) => !hidden.includes(box.id));
  const isShown = (box: HomeBox) => !hidden.includes(box.id);
  const hiddenBoxes = draft.boxes.filter((box) => hidden.includes(box.id));

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // After a move, add or remove, focus goes back to the same control of the box it acted on.
  useEffect(() => {
    if (!focusTarget) return;
    const target = document.querySelector<HTMLElement>(
      `[data-box-id="${CSS.escape(focusTarget.id)}"] [data-action="${focusTarget.action}"]`,
    );
    (target ?? titleRef.current)?.focus();
  }, [focusTarget, draft]);

  // Escape is Cancel, asking first when something changed; during a drag it cancels the drag.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || hostDialogOpen() || dragging.current) return;
      e.preventDefault();
      if (changed) setConfirm("discard");
      else stop();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [changed, stop]);

  function positionOf(id: string, layout: HomeLayoutDoc): string {
    const visible = layout.boxes.filter(isShown);
    return `position ${visible.findIndex((box) => box.id === id) + 1} of ${visible.length}`;
  }

  const shownIds = shown.map((box) => box.id);
  const placeOf = (id: string | number) => shownIds.indexOf(String(id)) + 1;
  const nameOf = (id: string | number) => names.current.get(String(id)) ?? "the box";
  // The place last announced, so a drag over the same place says nothing again.
  const announcedOver = useRef<string | null>(null);
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      announcedOver.current = String(active.id);
      return `Picked up ${nameOf(active.id)}, position ${placeOf(active.id)} of ${shownIds.length}`;
    },
    onDragOver: ({ over }) => {
      if (!over || String(over.id) === announcedOver.current) return undefined;
      announcedOver.current = String(over.id);
      return `Moved to position ${placeOf(over.id)} of ${shownIds.length}`;
    },
    onDragEnd: ({ active, over }) =>
      `Dropped at position ${placeOf(over?.id ?? active.id)} of ${shownIds.length}`,
    onDragCancel: ({ active }) => `Cancelled, back at position ${placeOf(active.id)}`,
  };

  // A drag ends after the key that ended it has been handled, so that key is not also the editor's.
  function endDrag() {
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    endDrag();
    if (over) update(moveBoxTo(draft, String(active.id), String(over.id), isShown));
  }

  function move(box: HomeBox, direction: -1 | 1, name: string) {
    const next = moveBox(draft, box.id, direction, isShown);
    if (next === draft) return;
    update(next);
    setAnnouncement(`Moved ${name} to ${positionOf(box.id, next)}`);
    setFocusTarget({ id: box.id, action: "more" });
  }

  function toggleWidth(box: HomeBox, name: string) {
    const width = box.width === "full" ? "half" : "full";
    update(setBoxWidth(draft, box.id, width));
    setAnnouncement(`${name} is now ${width} width`);
    setFocusTarget({ id: box.id, action: "width" });
  }

  function remove(box: HomeBox, name: string) {
    const index = shown.findIndex((other) => other.id === box.id);
    const neighbour = shown[index + 1] ?? shown[index - 1];
    update(removeBox(draft, box.id));
    setAnnouncement(`Removed ${name}`);
    setFocusTarget(neighbour ? { id: neighbour.id, action: "remove" } : null);
    if (!neighbour) titleRef.current?.focus();
  }

  function askRemove(box: HomeBox, name: string) {
    if (boxLimit(box)) setConfirm({ remove: box.id });
    else remove(box, name);
  }

  function added(layout: HomeLayoutDoc, id: string, kind: string) {
    update(layout);
    setAnnouncement(`Added ${boxName(kind)} at ${positionOf(id, layout)}`);
    setFocusTarget({ id, action: "reorder" });
  }

  // A kind that needs settings asks for them first; Cancel there adds nothing.
  function add(kind: string) {
    setSheetOpen(false);
    const entry = boxKind(kind);
    if (entry?.settingsReadable && !entry.defaultSettings) {
      setSettingsFor({ adding: kind });
      return;
    }
    const { layout, id } = addBox(draft, kind, entry?.defaultSettings?.());
    added(layout, id, kind);
  }

  function closeSettings() {
    setSettingsFor(null);
    closeOpenedAt();
  }

  function saveSettings(settings: Record<string, unknown>) {
    const target = settingsTarget;
    closeSettings();
    if (!target) return;
    if ("adding" in target) {
      const { layout, id } = addBox(draft, target.adding, settings);
      added(layout, id, target.adding);
      return;
    }
    const box = draft.boxes.find((other) => other.id === target.boxId);
    if (!box) return;
    update(setBoxSettings(draft, box.id, settings));
    setAnnouncement(`Saved the settings of ${boxName(box.kind)}`);
    setFocusTarget({ id: box.id, action: "more" });
  }

  function done() {
    if (changed) void saveHomeLayout(draft, new Date().toISOString());
    stop();
  }

  async function reset() {
    setResetting(true);
    try {
      await resetHomeLayout();
      setConfirm(null);
      stop();
    } catch (err) {
      setConfirm(null);
      toast.error(`Home wasn't reset: ${graphqlErrorMessage(err, "Try again.")}`);
    } finally {
      setResetting(false);
    }
  }

  const removing =
    confirm && typeof confirm === "object"
      ? draft.boxes.find((box) => box.id === confirm.remove)
      : undefined;

  const picker = (
    <AddBoxList
      heading={!narrow}
      draft={draft}
      hiddenBoxes={hiddenBoxes}
      onAdd={add}
      onShowHere={(box) => {
        showHere(box.id);
        setAnnouncement(`${boxName(box.kind)} is shown on this device again`);
      }}
    />
  );

  return (
    // Escape here is Cancel, not the app's Close panel.
    <div data-owns-escape className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rim-line px-4">
        <h1 ref={titleRef} tabIndex={-1} className="text-sm font-medium text-rim-text outline-none">
          Editing Home
        </h1>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[96rem] space-y-4 px-4 py-5 sm:px-6">
            <header className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 basis-full text-sm text-rim-text-muted sm:basis-0 sm:flex-1">
                Changes save to your account when you press Done
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm("reset")}>
                Reset to default
              </Button>
              {narrow && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setSheetOpen(true)}
                >
                  Add a box
                </Button>
              )}
              <Button type="button" variant="secondary" size="sm" onClick={stop}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={done}>
                Done
              </Button>
            </header>
            <div className="@container">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                accessibility={{
                  announcements,
                  screenReaderInstructions: {
                    draggable:
                      "Press Space or Enter to pick up the box, the arrow keys to move it, Space to drop it and Escape to cancel.",
                  },
                }}
                onDragStart={({ active }) => {
                  dragging.current = true;
                  // Focus goes to the handle, so it is there after the drop and Escape reaches the drag.
                  document
                    .querySelector<HTMLElement>(
                      `[data-box-id="${CSS.escape(String(active.id))}"] [data-action="reorder"]`,
                    )
                    ?.focus();
                }}
                onDragEnd={onDragEnd}
                onDragCancel={endDrag}
              >
                <SortableContext items={shownIds} strategy={rectSortingStrategy}>
                  <ul className={GRID_CLASS} aria-label="Boxes on Home">
                    {shown.map((box, index) => (
                      <EditBox
                        key={box.id}
                        box={box}
                        first={index === 0}
                        last={index === shown.length - 1}
                        onName={(name) => names.current.set(box.id, name)}
                        onMove={(direction, name) => move(box, direction, name)}
                        onWidth={(name) => toggleWidth(box, name)}
                        onSettings={() => setSettingsFor({ boxId: box.id })}
                        onRemove={(name) => askRemove(box, name)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              {shown.length === 0 && (
                <p className="text-sm text-rim-text-muted">
                  No boxes. Add one, or Reset to default.
                </p>
              )}
            </div>
          </div>
        </div>
        {!narrow && (
          <aside
            aria-label="Add a box"
            className="w-72 shrink-0 overflow-y-auto border-l border-rim-line px-4 py-5"
          >
            {picker}
          </aside>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {narrow && (
        <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add a box">
          {picker}
        </Dialog>
      )}
      {confirm === "discard" && (
        <ConfirmActionDialog
          title="Discard your changes?"
          description="Home stays as it was before you started editing."
          confirmLabel="Discard"
          danger
          focusConfirm
          onConfirm={() => {
            setConfirm(null);
            stop();
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "reset" && (
        <ConfirmActionDialog
          title="Reset Home to the default?"
          description="Home goes back to today's default layout on every device."
          confirmLabel="Reset"
          danger
          isPending={resetting}
          onConfirm={() => void reset()}
          onClose={() => setConfirm(null)}
        />
      )}
      {settingsTarget && (
        <SettingsFor
          target={settingsTarget}
          draft={draft}
          onSave={saveSettings}
          onClose={closeSettings}
        />
      )}
      {removing && (
        <ConfirmActionDialog
          title="Remove from Home on every device?"
          description={`${boxName(removing.kind)} can't run on this device, but your other devices may show it.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            setConfirm(null);
            remove(removing, boxName(removing.kind));
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/**
 * One box in edit mode: its name, what it shows, and its controls. Its header drags it by pointer
 * or touch; its Reorder handle drags it from the keyboard. Its More menu moves it up or down,
 * opens its settings or removes it, so dragging is never the only way.
 */
function EditBox({
  box,
  first,
  last,
  onName,
  onMove,
  onWidth,
  onSettings,
  onRemove,
}: {
  box: HomeBox;
  first: boolean;
  last: boolean;
  /** Reports the name the box shows, for what is announced while it is dragged. */
  onName: (name: string) => void;
  onMove: (direction: -1 | 1, name: string) => void;
  onWidth: (name: string) => void;
  onSettings: () => void;
  onRemove: (name: string) => void;
}) {
  const name = useBoxTitle(box);
  const kind = boxKind(box.kind);
  const limit = boxLimit(box);
  const full = box.width === "full";
  const note =
    limit ?? (settingsNeedFixing(box) ? "This box's settings need fixing" : kind?.description);
  const {
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: box.id });
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // The keyboard picks a box up through its handle alone; the pointer through the whole header.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};

  useEffect(() => {
    onName(name);
  }, [onName, name]);

  const menuItems: DropdownMenuItem[] = [
    ...(first ? [] : [{ id: "up", label: "Move up", onSelect: () => onMove(-1, name) }]),
    ...(last ? [] : [{ id: "down", label: "Move down", onSelect: () => onMove(1, name) }]),
    ...(kind?.settingsReadable && !limit
      ? [{ id: "settings", label: "Settings", onSelect: onSettings }]
      : []),
    { id: "remove", label: "Remove", danger: true, onSelect: () => onRemove(name) },
  ];

  return (
    <li
      ref={setNodeRef}
      data-box-id={box.id}
      style={{
        transform: DndCss.Translate.toString(transform),
        transition: transition,
      }}
      className={cn(
        "min-w-0 rounded-lg border border-dashed border-rim-line-strong bg-rim-panel-soft",
        widthClass(box),
        isDragging && "relative z-10 border-solid shadow-2xl shadow-black/60",
      )}
    >
      <div
        {...pointerListeners}
        className="flex cursor-grab touch-none flex-wrap items-center gap-1.5 border-b border-rim-line px-2 py-2 active:cursor-grabbing"
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          data-action="reorder"
          {...attributes}
          onKeyDown={onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
          aria-label={`Reorder ${name}`}
          title={`Reorder ${name}`}
          className="inline-flex h-7 w-6 cursor-grab items-center justify-center rounded text-rim-text-faint hover:text-rim-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent active:cursor-grabbing"
        >
          <GripVertical aria-hidden className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-rim-text">{name}</span>
        <Control
          action="width"
          label={full ? `Make ${name} half width` : `Make ${name} full width`}
          onClick={() => onWidth(name)}
        >
          {full ? (
            <Minimize2 aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 aria-hidden className="h-3.5 w-3.5" />
          )}
          <span className="ml-1">{full ? "Make half" : "Make full"}</span>
        </Control>
        <button
          type="button"
          ref={moreRef}
          data-action="more"
          aria-label={`More for ${name}`}
          title={`More for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={() => {
            if (menuAt) {
              setMenuAt(null);
              return;
            }
            const rect = moreRef.current?.getBoundingClientRect();
            setMenuAt({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
          }}
          className={CONTROL_CLASS}
        >
          <Ellipsis aria-hidden className="h-3.5 w-3.5" />
        </button>
        <Control action="remove" label={`Remove ${name}`} onClick={() => onRemove(name)}>
          <X aria-hidden className="h-3.5 w-3.5 text-rim-danger" />
        </Control>
      </div>
      <p className="px-3 py-2 text-xs text-rim-text-muted">{note}</p>
      {menuAt && (
        <DropdownMenu
          label={`More for ${name}`}
          position={menuAt}
          anchorRef={moreRef}
          closeOnSelect
          onClose={() => setMenuAt(null)}
          items={menuItems}
        />
      )}
    </li>
  );
}

/**
 * A control of a box. One that cannot act stays focusable and says so, so focus stays on it
 * after a move takes the box to the first or last place.
 */
function Control({
  action,
  label,
  disabled = false,
  onClick,
  children,
}: {
  action: BoxAction;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-action={action}
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={CONTROL_CLASS}
    >
      {children}
    </button>
  );
}

/** The kinds that can be added, and the boxes hidden on this device with a way to show them. */
function AddBoxList({
  heading,
  draft,
  hiddenBoxes,
  onAdd,
  onShowHere,
}: {
  /** Whether the list names itself; the sheet's title names it in a narrow window. */
  heading: boolean;
  draft: HomeLayoutDoc;
  hiddenBoxes: readonly HomeBox[];
  onAdd: (kind: string) => void;
  onShowHere: (box: HomeBox) => void;
}) {
  const full = draft.boxes.length >= MAX_BOXES;
  const kinds = BOX_KINDS.filter(
    (kind) => kind.multiple || !draft.boxes.some((box) => box.kind === kind.kind),
  );
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        {heading && <h2 className="text-sm font-semibold text-rim-text">Add a box</h2>}
        {kinds.length === 0 && (
          <p className="text-xs text-rim-text-muted">Every box is on Home already.</p>
        )}
        {full && <p className="text-xs text-rim-text-muted">Home holds at most 30 boxes.</p>}
        <ul className="space-y-2">
          {kinds.map((kind) => {
            const reason = kind.unavailableReason();
            return (
              <li
                key={kind.kind}
                className="flex items-start gap-2 rounded-lg border border-rim-line px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-rim-text">{kind.name}</span>
                  <span className="block text-xs text-rim-text-muted">
                    {reason ?? kind.description}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={full}
                  aria-label={`Add ${kind.name}`}
                  onClick={() => onAdd(kind.kind)}
                >
                  Add
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-rim-text-faint">
          Not shown on this device
        </h2>
        {hiddenBoxes.length === 0 ? (
          <p className="text-xs text-rim-text-muted">Nothing hidden here.</p>
        ) : (
          <ul className="space-y-2">
            {hiddenBoxes.map((box) => (
              <li key={box.id} className="flex items-center gap-2 text-sm text-rim-text">
                <span className="min-w-0 flex-1 truncate">{boxName(box.kind)}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`Show ${boxName(box.kind)} on this device`}
                  onClick={() => onShowHere(box)}
                >
                  Show here
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The settings dialog of the box `target` names, or of the kind about to be added. */
function SettingsFor({
  target,
  draft,
  onSave,
  onClose,
}: {
  target: { adding: string } | { boxId: string };
  draft: HomeLayoutDoc;
  onSave: (settings: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const box = "boxId" in target ? draft.boxes.find((other) => other.id === target.boxId) : null;
  const kind = "adding" in target ? target.adding : (box?.kind ?? "");
  const placeholder: HomeBox = box ?? { id: "", kind, width: "half" };
  const name = useBoxTitle(placeholder);
  if ("boxId" in target && !box) return null;
  return (
    <BoxSettingsDialog
      kind={kind}
      title={box ? `Settings of ${name}` : `Add a box: ${boxName(kind)}`}
      initial={box?.settings}
      adding={!box}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
