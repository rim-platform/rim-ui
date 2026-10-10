import { NEWER_SERVER_API_MESSAGE, useServerInfo } from "../hooks/useServerInfo";

/** The connected server's version under the client's; nothing while it loads. */
export function AboutServerVersion() {
  const { info, unreachable } = useServerInfo();
  if (unreachable) return <p className="text-xs text-rim-text-faint">Server unreachable</p>;
  if (!info) return null;
  return <p className="text-xs text-rim-text-faint">Server {info.version}</p>;
}

/** A banner when the server speaks a newer API than this client; nothing otherwise. */
export function AboutServerApiBanner() {
  const { newerApi } = useServerInfo();
  if (!newerApi) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-rim-warm/40 bg-rim-warm/10 px-3 py-2 text-sm text-rim-warm"
    >
      {NEWER_SERVER_API_MESSAGE}
    </p>
  );
}
