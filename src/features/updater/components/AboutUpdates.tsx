import { Button } from "../../../shared/ui/Button";
import { useClientVersion } from "../hooks/useClientVersion";
import { useUpdater, type UpdaterView } from "../hooks/useUpdater";

/** The running client's version, as the About page shows it. */
export function AboutVersion() {
  const version = useClientVersion();
  return <p className="text-xs text-rim-text-faint">Version {version}</p>;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function summaryOf(view: UpdaterView): string {
  const version = view.available?.version;
  switch (view.status) {
    case "loading":
      return "Reading the update settings...";
    case "idle":
      return "Not checked yet.";
    case "checking":
      return "Checking for updates...";
    case "upToDate":
      return view.lastCheckedAt === null
        ? "You have the latest version."
        : `You have the latest version. Last checked ${formatTime(view.lastCheckedAt)}.`;
    case "available":
      return `Version ${version} is available.`;
    case "downloading":
      return `Downloading version ${version}...`;
    case "ready":
      return `Version ${version} is downloaded. Restart to finish updating.`;
    case "installing":
      return `Installing version ${version}...`;
    case "error":
      return version ? `Version ${version} is available.` : "The last check did not finish.";
    case "unconfigured":
    case "unsupported":
      return "Updates are not configured in this build";
  }
}

function UpdateAction({ view }: { view: UpdaterView }) {
  switch (view.status) {
    case "idle":
    case "upToDate":
    case "checking":
      return (
        <Button
          variant="secondary"
          size="sm"
          isLoading={view.status === "checking"}
          onClick={() => void view.check()}
        >
          Check for updates
        </Button>
      );
    case "available":
      return (
        <Button size="sm" onClick={() => void view.download()}>
          Download update
        </Button>
      );
    case "error":
      return view.available ? (
        <Button size="sm" onClick={() => void view.download()}>
          Download update
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => void view.check()}>
          Check for updates
        </Button>
      );
    case "ready":
    case "installing":
      return (
        <Button
          size="sm"
          isLoading={view.status === "installing"}
          onClick={() => void view.restart()}
        >
          Restart to update
        </Button>
      );
    default:
      return null;
  }
}

function DownloadBar({ progress }: { progress: number | null }) {
  const percent = progress === null ? null : Math.round(progress * 100);
  return (
    <div
      role="progressbar"
      aria-label="Update download"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="h-1.5 w-full overflow-hidden rounded-full bg-rim-void"
    >
      <div
        className={
          percent === null
            ? "h-full w-1/3 animate-pulse rounded-full bg-rim-accent"
            : "h-full rounded-full bg-rim-accent transition-[width]"
        }
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

/** The About page's "Updates" row; nothing on a runtime that does not update itself. */
export function AboutUpdates() {
  const view = useUpdater();
  if (view.status === "unsupported") return null;

  const notes = view.available?.notes?.trim();

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-5 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rim-text">Updates</p>
          <p className="mt-0.5 text-xs text-rim-text-muted" data-testid="updater-summary">
            {summaryOf(view)}
          </p>
        </div>
        <UpdateAction view={view} />
      </div>

      {view.status === "downloading" && <DownloadBar progress={view.progress} />}

      {notes && (
        <div className="rounded-md bg-rim-void px-3 py-2">
          <p className="text-xs text-rim-text-faint">Release notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-rim-text-muted">{notes}</p>
        </div>
      )}

      {view.error && (
        <p role="alert" className="text-xs text-rim-danger">
          {view.error}
        </p>
      )}
    </div>
  );
}
