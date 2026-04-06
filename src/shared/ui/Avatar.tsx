import { cn } from "./cn";

// TODO: Replace hardcoded Tailwind color classes with rim-* design tokens
// (e.g. bg-rim-avatar-1 through bg-rim-avatar-16) once avatar color CSS
// custom properties are defined in src/styles/globals.css.
const AVATAR_COLORS = [
  "bg-red-600", "bg-orange-600", "bg-amber-600", "bg-yellow-600",
  "bg-lime-600", "bg-green-600", "bg-emerald-600", "bg-teal-600",
  "bg-cyan-600", "bg-sky-600", "bg-blue-600", "bg-indigo-600",
  "bg-violet-600", "bg-purple-600", "bg-fuchsia-600", "bg-pink-600",
];

function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(userId: string): string {
  return AVATAR_COLORS[hashUserId(userId) % AVATAR_COLORS.length];
}

const SIZE_MAP = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-xs",
  lg: "h-20 w-20 text-2xl",
} as const;

const PRESENCE_SIZE_MAP = {
  xs: "h-2 w-2",
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3.5 w-3.5",
} as const;

export type PresenceStatus = "ONLINE" | "AWAY" | "OFFLINE";

export interface AvatarProps {
  url?: string | null;
  name: string;
  userId: string;
  size?: "xs" | "sm" | "md" | "lg";
  presenceStatus?: PresenceStatus | null;
  className?: string;
}

export function Avatar({
  url,
  name,
  userId,
  size = "md",
  presenceStatus,
  className,
}: AvatarProps) {
  const sizeClass = SIZE_MAP[size];
  const initial = name.charAt(0).toUpperCase() || "?";

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {url ? (
        <img
          src={url}
          alt={name}
          className={cn("rounded-full object-cover", sizeClass)}
        />
      ) : (
        <span
          className={cn(
            "flex items-center justify-center rounded-full font-medium text-white",
            sizeClass,
            getAvatarColor(userId),
          )}
        >
          {initial}
        </span>
      )}
      {presenceStatus && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-2 ring-rim-panel",
            PRESENCE_SIZE_MAP[size],
            presenceStatus === "ONLINE" && "bg-rim-success",
            presenceStatus === "AWAY" && "bg-rim-warm",
            presenceStatus === "OFFLINE" && "bg-rim-text-faint",
          )}
        />
      )}
    </span>
  );
}
