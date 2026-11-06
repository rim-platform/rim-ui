import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "../../../shared/ui/cn";

const ROW =
  "flex w-full items-center gap-3 rounded-[10px] border border-rim-line bg-rim-panel px-3.5 py-3 text-left transition hover:border-rim-line-strong hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rim-accent";

/** The attribute the sign-in page looks for to tell whether any row renders. */
const WAY_IN_ATTRIBUTE = "data-way-in";

interface WayInRowProps {
  /** The way's name, which is also the row's accessible name. */
  title: string;
  /** One line saying when to use it. */
  hint: string;
  icon: ReactNode;
  /** A button that opens something here, or a link to another page. */
  onClick?: () => void;
  to?: string;
  className?: string;
}

/**
 * One way in on the sign-in page: an icon, its name, a line saying when you would use it, and a
 * chevron. A button when it opens a form on the page, a link when it goes to another page.
 */
export function WayInRow({ title, hint, icon, onClick, to, className }: WayInRowProps) {
  const id = useId();
  const body = (
    <>
      <span aria-hidden="true" className="flex shrink-0 text-rim-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-t`} className="block text-sm font-medium text-rim-text">
          {title}
        </span>
        <span id={`${id}-h`} className="block text-xs text-rim-text-muted">
          {hint}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-rim-text-muted" />
    </>
  );
  const shared = {
    [WAY_IN_ATTRIBUTE]: "",
    "aria-labelledby": `${id}-t`,
    "aria-describedby": `${id}-h`,
    className: cn(ROW, className),
  };
  if (to !== undefined) {
    return (
      <Link to={to} {...shared}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} {...shared}>
      {body}
    </button>
  );
}
