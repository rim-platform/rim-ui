import { SlidersHorizontal, X } from "lucide-react";

interface LensBannerProps {
  lensName: string;
  conditionCount: number;
  onClear: () => void;
}

export function LensBanner({ lensName, conditionCount, onClear }: LensBannerProps) {
  return (
    <div className="flex items-center gap-2 border-b border-rim-accent/20 bg-rim-accent/5 px-4 py-1.5 text-xs">
      <SlidersHorizontal className="h-3 w-3 text-rim-accent" />
      <span className="font-medium text-rim-accent">{lensName}</span>
      <span className="text-rim-text-muted">
        {conditionCount} {conditionCount === 1 ? "condition" : "conditions"}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear lens"
        className="ml-auto rounded p-0.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
