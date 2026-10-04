import { useRuntime } from "../../core/runtime/RuntimeProvider";
import { WindowControls } from "../../shared/ui/WindowControls";

export function TitleBar() {
  const { osType } = useRuntime();

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-end border-b border-rim-line bg-rim-void"
    >
      {osType !== "macos" && <WindowControls />}
    </div>
  );
}
