import { WebhookPreset } from "../../../core/graphql/generated/schema-types";
import { ShowOnceDialog } from "./ShowOnceDialog";

/** The steps that connect a GitHub repository to a webhook of the GitHub preset, for a host without formats. */
export const GITHUB_SETUP_NOTE =
  "In the repository's Settings > Webhooks, paste this as the Payload URL, choose application/json, and leave Secret empty. RIM posts releases, pull requests and issues.";

interface WebhookUrlDialogProps {
  /** The whole URL, held only by whoever renders this. */
  url: string;
  preset: WebhookPreset;
  /** The host's setup note for a ready-made format; the GitHub one above when it has none. */
  setupNote?: string;
  /** Whether the URL is the test URL already handed out, which now posts. */
  keptTestUrl?: boolean;
  onClose: () => void;
}

/**
 * Shows a new webhook's URL once, with what to set up on the service's side: the host's note for
 * a ready-made format, or the GitHub steps for the GitHub preset of an older host.
 */
export function WebhookUrlDialog({
  url,
  preset,
  setupNote,
  keptTestUrl = false,
  onClose,
}: WebhookUrlDialogProps) {
  const note = setupNote ?? (preset === WebhookPreset.GITHUB ? GITHUB_SETUP_NOTE : null);
  return (
    <ShowOnceDialog title="Webhook URL" label="URL" value={url} onClose={onClose}>
      {keptTestUrl && (
        <p className="text-sm text-rim-text-muted">
          This is the test URL you already used, so there is nothing to change in the service. It
          now posts to the channel.
        </p>
      )}
      {note && <p className="text-sm text-rim-text-muted">{note}</p>}
    </ShowOnceDialog>
  );
}
