import { memo } from "react";

import { HoverTooltip } from "../../../../shared/ui/HoverTooltip";
import { formatEditedAt } from "../../../../shared/utils/formatTime";

/** The "(edited)" note after an edited message's text; hovering or focusing it shows when. */
export const EditedMark = memo(function EditedMark({ editedAt }: { editedAt: string }) {
  if (Number.isNaN(new Date(editedAt).getTime())) return null;
  const label = `Edited ${formatEditedAt(editedAt)}`;
  return (
    <HoverTooltip
      content={<span className="text-xs text-rim-text whitespace-nowrap">{label}</span>}
    >
      <span tabIndex={0} aria-label={label} className="text-xs text-rim-text-faint">
        (edited)
      </span>
    </HoverTooltip>
  );
});
