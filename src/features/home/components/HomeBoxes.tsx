import { useId, type ReactNode } from "react";

import { cn } from "../../../shared/ui/cn";
import { boxKind, settingsNeedFixing, type HomeBoxData } from "../boxes/registry";
import { useBoxTitle } from "../boxes/useBoxTitle";
import { boxLimit, GRID_CLASS, widthClass } from "../boxes/boxPlacement";
import type { HomeBox, HomeLayoutDoc } from "../layout/homeLayout";

/** A box: its title, the number beside it, a mark while it may be out of date, and its content. */
export function BoxFrame({
  box,
  title,
  count,
  stale,
  actions,
  children,
}: {
  box: HomeBox;
  title: string;
  count?: number | null;
  stale?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-box-id={box.id}
      className={cn("min-w-0 rounded-lg border border-rim-line bg-rim-panel-soft", widthClass(box))}
    >
      <div className="flex min-h-10 items-center gap-2 border-b border-rim-line px-3 py-2">
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold text-rim-text">
          {title}
        </h2>
        {stale && <span className="shrink-0 text-xs text-rim-warm">not up to date</span>}
        {count != null && <span className="shrink-0 text-xs text-rim-warm">{count}</span>}
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** A box shown as one line, with why, and what can be done about it here. */
export function BoxLine({
  box,
  title,
  text,
  children,
}: {
  box: HomeBox;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={title}
      data-box-id={box.id}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-dashed border-rim-line px-3 py-2 text-sm text-rim-text-muted",
        widthClass(box),
      )}
    >
      <span className="min-w-0 flex-1">{text}</span>
      {children}
    </div>
  );
}

const LINE_BUTTON_CLASS =
  "shrink-0 rounded border border-rim-line px-2 py-0.5 text-xs text-rim-text-muted transition hover:text-rim-text";

/**
 * One box as Home shows it: its content, or one line saying why not. A box this device cannot
 * run offers to be hidden here; one whose settings cannot be read offers to fix them.
 */
function BoxView({
  box,
  data,
  stale,
  onHide,
  onFixSettings,
}: {
  box: HomeBox;
  data: HomeBoxData;
  stale: boolean;
  onHide: (id: string) => void;
  onFixSettings: (id: string) => void;
}) {
  const title = useBoxTitle(box);
  const kind = boxKind(box.kind);
  const limit = boxLimit(box);
  if (!kind || limit) {
    return (
      <BoxLine box={box} title={title} text={limit ?? ""}>
        {kind && (
          <button type="button" onClick={() => onHide(box.id)} className={LINE_BUTTON_CLASS}>
            Don&apos;t show on this device
          </button>
        )}
      </BoxLine>
    );
  }
  if (settingsNeedFixing(box)) {
    return (
      <BoxLine box={box} title={title} text="This box's settings need fixing">
        <button type="button" onClick={() => onFixSettings(box.id)} className={LINE_BUTTON_CLASS}>
          Fix settings
        </button>
      </BoxLine>
    );
  }
  return (
    <BoxFrame box={box} title={title} count={kind.count(data)} stale={stale && kind.fromServer}>
      {kind.render(data, box)}
    </BoxFrame>
  );
}

/**
 * Home's boxes in their order, leaving out those hidden on this device. A box this device cannot
 * run, of a kind this app does not know, or with settings it cannot read is one line in its
 * place.
 */
export function HomeBoxGrid({
  layout,
  hidden,
  data,
  stale,
  onHide,
  onFixSettings,
}: {
  layout: HomeLayoutDoc;
  hidden: readonly string[];
  data: HomeBoxData;
  /** The home server cannot be reached, so what comes from it may be out of date. */
  stale: boolean;
  onHide: (id: string) => void;
  /** Opens Edit Home at the settings of the box `id`. */
  onFixSettings: (id: string) => void;
}) {
  return (
    <div className="@container">
      <div className={GRID_CLASS}>
        {layout.boxes
          .filter((box) => !hidden.includes(box.id))
          .map((box) => (
            <BoxView
              key={box.id}
              box={box}
              data={data}
              stale={stale}
              onHide={onHide}
              onFixSettings={onFixSettings}
            />
          ))}
      </div>
    </div>
  );
}
