import {
  WebhookPreviewOutcome,
  type WebhookFormatPreview,
} from "../../../core/graphql/generated/schema-types";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { outcomeSentence, previewMessage } from "../formats/outcome";

/** A preview's outcome, with the message it would post drawn as a chat message is. */
export function PreviewOutcome({ preview }: { preview: WebhookFormatPreview }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-rim-text">{outcomeSentence(preview)}</p>
      {preview.outcome === WebhookPreviewOutcome.POSTS && (
        <div className="rounded-lg border border-rim-line bg-rim-void px-3 py-2">
          <MarkdownRenderer content={previewMessage(preview)} />
        </div>
      )}
    </div>
  );
}
