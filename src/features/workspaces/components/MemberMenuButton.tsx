import { MoreVertical } from "lucide-react";

import { cn } from "../../../shared/ui/cn";

/**
 * The button of a member row that opens the row's person menu, the one a right click on the
 * row opens.
 *
 * @param onOpen - Opens the menu under the button.
 */
export function MemberMenuButton({
  name,
  onOpen,
  className,
}: {
  name: string;
  onOpen: (button: HTMLElement) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Actions for ${name}`}
      aria-haspopup="menu"
      onClick={(event) => onOpen(event.currentTarget)}
      className={cn(
        "shrink-0 rounded p-1 text-rim-text-faint transition hover:bg-white/5 hover:text-rim-text",
        className,
      )}
    >
      <MoreVertical className="h-3.5 w-3.5" />
    </button>
  );
}
