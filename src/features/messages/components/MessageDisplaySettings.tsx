import { useClockFormatStore, type ClockFormat } from "../../../shared/state/useClockFormatStore";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import { useMessageDisplaySettingsStore } from "../state/useMessageDisplaySettingsStore";

/** Device-local choices for how messages render. */
export function MessageDisplaySettings() {
  const showInlineMedia = useMessageDisplaySettingsStore((s) => s.showInlineMedia);
  const setShowInlineMedia = useMessageDisplaySettingsStore((s) => s.setShowInlineMedia);

  const clockFormat = useClockFormatStore((s) => s.clockFormat);
  const setClockFormat = useClockFormatStore((s) => s.setClockFormat);

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
      <section aria-labelledby="message-time-heading">
        <h3 id="message-time-heading" className="text-sm font-semibold text-rim-text">
          Time
        </h3>
        <div className="mt-2 rounded-lg border border-rim-line bg-rim-panel px-4">
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-sm font-medium text-rim-text">Clock</div>
              <div className="text-xs text-rim-text-muted">
                How times of day are shown on this device. Automatic follows the browser's language.
              </div>
            </div>
            <select
              aria-label="Clock"
              value={clockFormat}
              onChange={(e) => setClockFormat(e.target.value as ClockFormat)}
              className="rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent/40"
            >
              <option value="auto">Automatic</option>
              <option value="12h">12-hour (9:05 PM)</option>
              <option value="24h">24-hour (21:05)</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
