import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import { useMessageDisplaySettingsStore } from "../state/useMessageDisplaySettingsStore";

/** Device-local choices for how messages render. */
export function MessageDisplaySettings() {
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);
  const setShowInlineMedia = useMessageDisplaySettingsStore((s) => s.setShowInlineMedia);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Messages</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          How messages look on this device. Other devices keep their own choices.
        </p>
      </div>
      <section aria-labelledby="message-media-heading">
        <h3 id="message-media-heading" className="text-sm font-semibold text-rim-text">
          Media
        </h3>
        <div className="mt-2 rounded-lg border border-rim-line bg-rim-panel px-4">
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-sm font-medium text-rim-text">Show inline media</div>
              <div className="text-xs text-rim-text-muted">
                Show attached images and videos, link preview images and Markdown images in the
                conversation. Off shows file chips and links instead, and nothing loads from other
                sites.
              </div>
            </div>
            <ToggleSwitch
              checked={showInlineMedia}
              onChange={setShowInlineMedia}
              label="Show inline media"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
