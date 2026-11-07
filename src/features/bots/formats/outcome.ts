import {
  WebhookPreviewOutcome,
  type WebhookFormatPreview,
} from "../../../core/graphql/generated/schema-types";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";

/** What a preview of a sample says, in one sentence. */
export function outcomeSentence(preview: WebhookFormatPreview): string {
  switch (preview.outcome) {
    case WebhookPreviewOutcome.POSTS:
      return `Rule ${preview.rule ?? "?"} matches. It would post:`;
    case WebhookPreviewOutcome.NO_RULE:
      return "No rule matches, so nothing would post.";
    case WebhookPreviewOutcome.NO_VALUE:
      return `Rule ${preview.rule ?? "?"} matches, but \`${showInvisibleCharacters(preview.placeholder ?? "")}\` has no value, so nothing would post.`;
    case WebhookPreviewOutcome.BODY_REFUSED:
      return preview.reason ?? "The body would be refused.";
    case WebhookPreviewOutcome.FORMAT_REFUSED:
      return `The format would be refused: ${preview.reason ?? ""}`;
  }
}

/** The short outcome of one logged delivery under the draft on screen. */
export function outcomeLabel(preview: WebhookFormatPreview): string {
  switch (preview.outcome) {
    case WebhookPreviewOutcome.POSTS:
      return "Would post";
    case WebhookPreviewOutcome.NO_RULE:
      return "No rule matches";
    case WebhookPreviewOutcome.NO_VALUE:
      return `\`${showInvisibleCharacters(preview.placeholder ?? "")}\` has no value`;
    case WebhookPreviewOutcome.BODY_REFUSED:
      return "Not JSON";
    case WebhookPreviewOutcome.FORMAT_REFUSED:
      return "The format is refused";
  }
}

/** The message a preview says would post: its text, then its link after a space. */
export function previewMessage(preview: WebhookFormatPreview): string {
  return preview.link ? `${preview.text ?? ""} ${preview.link}` : (preview.text ?? "");
}
