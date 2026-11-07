import { WebhookPreset } from "../../../core/graphql/generated/schema-types";
import { ShowOnceDialog } from "./ShowOnceDialog";

/** The steps that connect a GitHub repository to a webhook of the GitHub preset. */
export const GITHUB_SETUP_NOTE =
  "In the repository's Settings > Webhooks, paste this as the Payload URL, choose application/json, and leave Secret empty. RIM posts releases, pull requests and issues.";

interface WebhookUrlDialogProps {
  /** The whole URL, held only by whoever renders this. */
  url: string;
  preset: WebhookPreset;
  onClose: () => void;
}

/** Shows a new webhook's URL once, with the GitHub setup steps for the GitHub preset. */
export function WebhookUrlDialog({ url, preset, onClose }: WebhookUrlDialogProps) {
  return (
    <ShowOnceDialog title="Webhook URL" label="URL" value={url} onClose={onClose}>
      {preset === WebhookPreset.GITHUB && (
        <p className="text-sm text-rim-text-muted">{GITHUB_SETUP_NOTE}</p>
      )}
    </ShowOnceDialog>
  );
}
