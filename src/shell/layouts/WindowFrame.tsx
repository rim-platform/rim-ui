import { Outlet } from "react-router-dom";

import { useRuntime } from "../../core/runtime/RuntimeProvider";
import { TitleBar } from "../components/TitleBar";

/** Layout route that gives the screens outside the app shell the desktop title bar. */
export function WindowFrame() {
  const { capabilities } = useRuntime();

  return (
    <div className="flex h-screen flex-col bg-rim-void text-rim-text">
      {capabilities.customTitleBar && <TitleBar />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
