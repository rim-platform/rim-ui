import { MAX_LISTED_CHANNELS } from "../api/useAllChannels";

/** Says a channel list holds only the first channels of a larger workspace. */
export function ChannelsCutNotice() {
  return (
    <p role="status" className="text-xs text-rim-warm">
      This workspace has more channels than can be listed here. The list was cut after{" "}
      {MAX_LISTED_CHANNELS.toLocaleString("en-US")}.
    </p>
  );
}
