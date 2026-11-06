import { workspaceInitials } from "../../../shared/utils/initials";

/** A workspace's badge on the join screens: its initials, since a link's preview has no image. */
export function WorkspaceInitials({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rim-line-strong bg-rim-panel text-sm font-semibold text-rim-text"
    >
      {workspaceInitials(name)}
    </span>
  );
}
