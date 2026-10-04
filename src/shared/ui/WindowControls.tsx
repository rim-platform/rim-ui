import { cn } from "./cn";

interface WindowControlsProps {
  className?: string;
}

export function WindowControls({ className }: WindowControlsProps) {
  async function handleMinimize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (e) {
      console.error("WindowControls: minimize failed", e);
    }
  }

  async function handleMaximize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch (e) {
      console.error("WindowControls: toggleMaximize failed", e);
    }
  }

  async function handleClose() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      console.error("WindowControls: close failed", e);
    }
  }

  const baseBtn =
    "flex h-full w-[46px] items-center justify-center text-rim-text-muted transition-colors";

  return (
    <div className={cn("pointer-events-auto flex h-full items-center", className)}>
      <button
        type="button"
        tabIndex={-1}
        onClick={handleMinimize}
        className={cn(baseBtn, "hover:bg-white/5 hover:text-rim-text")}
        aria-label="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={handleMaximize}
        className={cn(baseBtn, "hover:bg-white/5 hover:text-rim-text")}
        aria-label="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="0.6" y="0.6" width="8.8" height="8.8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={handleClose}
        className={cn(baseBtn, "hover:bg-rim-danger hover:text-rim-text")}
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
