import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { isServerUnreachable } from "../../messages/api/messageCache";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useConnectionStore } from "../../system/state/useConnectionStore";
import { HOME_LAYOUT, hasCapability } from "../../updater/api/serverCapabilities";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { defaultLayout, type HomeLayoutDoc } from "../layout/homeLayout";
import { useHomeLayoutStore } from "../state/useHomeLayoutStore";
import { fetchHomeLayout, flushPendingHomeLayout, takeFetchedLayout } from "./homeLayoutApi";

/** The layout Home shows, and what Home says about it. */
export interface HomeLayoutView {
  layout: HomeLayoutDoc;
  /** The server keeps Home layouts, so Home can be edited. */
  editable: boolean;
  /** The home server cannot be reached right now. */
  unreachable: boolean;
  /** The layout changed on another device and the person has not read the notice yet. */
  changedElsewhere: boolean;
  dismissChangedElsewhere: () => void;
}

/**
 * The account's Home layout: the edit waiting on this device, else this device's copy of what
 * the server holds, else the default. A server that does not keep layouts is never asked, and
 * Home shows the default there.
 *
 * @param agents - Whether the default layout has Your agents' runs.
 */
export function useHomeLayout(agents: boolean): HomeLayoutView {
  const editable = hasCapability(useServerInfo().info, HOME_LAYOUT);
  const query = useQuery({
    queryKey: queryKeys.homeLayout,
    queryFn: fetchHomeLayout,
    enabled: editable,
    retry: false,
  });
  const copy = useHomeLayoutStore((s) => s.copy);
  const pending = useHomeLayoutStore((s) => s.pending);
  const changedElsewhere = useHomeLayoutStore((s) => s.changedElsewhere);
  const offline = useOfflineStore((s) => s.offline);
  const disconnected = useConnectionStore((s) => s.status === "disconnected");

  const fetched = query.data;
  const fetchedAt = query.dataUpdatedAt;
  useEffect(() => {
    if (fetched !== undefined) takeFetchedLayout(fetched);
  }, [fetched, fetchedAt]);

  useEffect(() => {
    if (editable) void flushPendingHomeLayout();
  }, [editable]);

  const stored = editable ? (pending ?? copy) : null;
  return {
    layout: stored?.layout ?? defaultLayout(agents),
    editable,
    unreachable: offline || disconnected || (query.isError && isServerUnreachable(query.error)),
    changedElsewhere: editable && changedElsewhere,
    dismissChangedElsewhere: () => useHomeLayoutStore.getState().setChangedElsewhere(false),
  };
}
