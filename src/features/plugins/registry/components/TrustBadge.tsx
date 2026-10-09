import { Copy, ShieldCheck, ShieldAlert } from "lucide-react";

import { toast } from "../../../../shared/toast";
import { trustBadge, type Publisher } from "../model";

/** The trust badge: who signed, the short principal id, the whole id on hover and copy. */
export function TrustBadge({ publisher }: { publisher: Publisher }) {
  const Icon = publisher.member ? ShieldCheck : ShieldAlert;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publisher.principalId);
      toast.success("Publisher id copied");
    } catch {
      toast.error("Could not copy the publisher id");
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={publisher.principalId}>
      <Icon
        className={publisher.member ? "h-3.5 w-3.5 text-rim-success" : "h-3.5 w-3.5 text-rim-warm"}
      />
      <span className={publisher.member ? "text-rim-text" : "text-rim-warm"}>
        {trustBadge(publisher)}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded p-0.5 text-rim-text-faint hover:text-rim-text"
        aria-label="Copy the publisher's id"
        title="Copy the publisher's id"
      >
        <Copy className="h-3 w-3" />
      </button>
    </span>
  );
}
