/**
 * The Home layout: the boxes Home shows, in order, each half or full width. The server keeps one
 * per account and checks only its shape; the kinds and their settings are this app's.
 */

/** How wide a box is: one of two columns, or both. */
export type BoxWidth = "half" | "full";

/**
 * One box of the layout. Fields this app does not know, and the settings of a kind it does not
 * know, are kept as they came, so saving the layout gives them back unchanged.
 */
export interface HomeBox {
  id: string;
  kind: string;
  width: BoxWidth;
  settings?: Record<string, unknown>;
  [field: string]: unknown;
}

/** The layout document as stored: `{ version: 1, boxes }`, with any other field kept. */
export interface HomeLayoutDoc {
  version: 1;
  boxes: HomeBox[];
  [field: string]: unknown;
}

/** The most boxes a layout holds, as the server allows. */
export const MAX_BOXES = 30;

/**
 * Today's Home in today's order, which Home shows while nothing is stored.
 *
 * @param agents - Whether Your agents' runs is on Home, as it is where agents are connected.
 */
export function defaultLayout(agents: boolean): HomeLayoutDoc {
  const boxes: HomeBox[] = [
    { id: "waiting", kind: "waiting", width: "half" },
    { id: "mentions", kind: "mentions", width: "half" },
    { id: "unread", kind: "unread", width: "half" },
  ];
  if (agents) boxes.push({ id: "agentRuns", kind: "agentRuns", width: "half" });
  return { version: 1, boxes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a stored layout: `null` when it is not a version 1 layout whose boxes each have an id, a
 * kind and a width, so Home shows the default instead.
 */
export function parseLayout(value: unknown): HomeLayoutDoc | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.boxes)) return null;
  const ids = new Set<string>();
  for (const box of value.boxes) {
    if (!isRecord(box)) return null;
    if (typeof box.id !== "string" || box.id.length === 0 || ids.has(box.id)) return null;
    if (typeof box.kind !== "string" || box.kind.length === 0) return null;
    if (box.width !== "half" && box.width !== "full") return null;
    if (box.settings !== undefined && !isRecord(box.settings)) return null;
    ids.add(box.id);
  }
  return value as HomeLayoutDoc;
}

/** Whether two layouts are the same, field for field. */
export function sameLayout(a: HomeLayoutDoc, b: HomeLayoutDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `layout` with the box `id` swapped with the nearest box before (`-1`) or after (`1`) it that
 * `shown` accepts; unchanged when there is none.
 */
export function moveBox(
  layout: HomeLayoutDoc,
  id: string,
  direction: -1 | 1,
  shown: (box: HomeBox) => boolean = () => true,
): HomeLayoutDoc {
  const boxes = [...layout.boxes];
  const from = boxes.findIndex((box) => box.id === id);
  if (from < 0) return layout;
  let to = from + direction;
  while (to >= 0 && to < boxes.length && !shown(boxes[to])) to += direction;
  if (to < 0 || to >= boxes.length) return layout;
  [boxes[from], boxes[to]] = [boxes[to], boxes[from]];
  return { ...layout, boxes };
}

/**
 * `layout` with the box `id` taken to the place of the box `overId`, counting only the boxes
 * `shown` accepts: the others keep their places. Unchanged when either is not shown.
 */
export function moveBoxTo(
  layout: HomeLayoutDoc,
  id: string,
  overId: string,
  shown: (box: HomeBox) => boolean = () => true,
): HomeLayoutDoc {
  const visible = layout.boxes.filter(shown);
  const from = visible.findIndex((box) => box.id === id);
  const to = visible.findIndex((box) => box.id === overId);
  if (from < 0 || to < 0 || from === to) return layout;
  const order = [...visible];
  const [moving] = order.splice(from, 1);
  order.splice(to, 0, moving);
  let next = 0;
  return { ...layout, boxes: layout.boxes.map((box) => (shown(box) ? order[next++] : box)) };
}

/** `layout` with the box `id` set to `width`. */
export function setBoxWidth(layout: HomeLayoutDoc, id: string, width: BoxWidth): HomeLayoutDoc {
  return {
    ...layout,
    boxes: layout.boxes.map((box) => (box.id === id ? { ...box, width } : box)),
  };
}

/** `layout` without the box `id`. */
export function removeBox(layout: HomeLayoutDoc, id: string): HomeLayoutDoc {
  return { ...layout, boxes: layout.boxes.filter((box) => box.id !== id) };
}

/** An id for a new box, unique in `layout`. */
export function newBoxId(layout: HomeLayoutDoc, kind: string): string {
  const taken = new Set(layout.boxes.map((box) => box.id));
  if (!taken.has(kind)) return kind;
  let n = 2;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

/**
 * `layout` with a half-width box of `kind` added at the end, and the new box's id.
 *
 * @param settings - The new box's settings, for a kind that has them.
 */
export function addBox(
  layout: HomeLayoutDoc,
  kind: string,
  settings?: Record<string, unknown>,
): { layout: HomeLayoutDoc; id: string } {
  const id = newBoxId(layout, kind);
  const box: HomeBox = settings
    ? { id, kind, width: "half", settings }
    : { id, kind, width: "half" };
  return { layout: { ...layout, boxes: [...layout.boxes, box] }, id };
}

/** `layout` with the box `id`'s settings replaced by `settings`. */
export function setBoxSettings(
  layout: HomeLayoutDoc,
  id: string,
  settings: Record<string, unknown>,
): HomeLayoutDoc {
  return {
    ...layout,
    boxes: layout.boxes.map((box) => (box.id === id ? { ...box, settings } : box)),
  };
}
