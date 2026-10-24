import { useEffect, useState } from "react";

import { getApiOrigin } from "../../../core/graphql/config";
import { featureDisabledFromResponse } from "../../../core/serverFeatures";
import { hostOf } from "../../relay/state/useRelayStore";
import { asResponse, remoteFetch } from "../../relay/transport/remoteFetch";

/** Downloads an attachment through its host's verified transport, or from the local server. */
export async function downloadAttachment(
  workspaceId: string | undefined,
  attachmentId: string,
): Promise<Blob> {
  const path = `/api/attachments/${encodeURIComponent(attachmentId)}/download`;
  const host = hostOf(workspaceId);
  const response = host
    ? asResponse(await remoteFetch(host, path, { method: "GET" }))
    : await fetch(`${getApiOrigin()}${path}`, { credentials: "include" });
  if (!response.ok)
    throw (
      (await featureDisabledFromResponse(response)) ??
      new Error(`Download failed: ${response.status}`)
    );
  return response.blob();
}

/** A host-owned media file as an object URL; its bytes never bypass host verification. */
export function useRemoteAttachment(
  workspaceId: string | undefined,
  attachmentId: string,
  contentType: string,
  enabled: boolean,
) {
  const key = `${workspaceId}:${attachmentId}:${contentType}`;
  const [loaded, setLoaded] = useState<{ key: string; src: string | null }>();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let created: string | null = null;
    void downloadAttachment(workspaceId, attachmentId)
      .then(async (blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([await blob.arrayBuffer()], { type: contentType }));
        if (cancelled) URL.revokeObjectURL(created);
        else setLoaded({ key, src: created });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, src: null });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [workspaceId, attachmentId, contentType, enabled, key]);
  const current = enabled && loaded?.key === key ? loaded : null;
  return { src: current?.src ?? null, failed: current?.src === null };
}
