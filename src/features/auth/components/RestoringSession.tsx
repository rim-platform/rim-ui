import { RimSplash } from "../../../shared/brand/RimLogo";

/** The bouncing RIM splash with a "Restoring session..." caption, announced as a status. */
export function RestoringSessionSplash() {
  return (
    <div role="status" className="flex flex-col items-center gap-4">
      <RimSplash className="w-32 text-rim-text" />
      <p className="text-sm text-rim-text-muted">Restoring session...</p>
    </div>
  );
}

/** Full-page placeholder for the auth routes while a session cookie is being checked. */
export function RestoringSession() {
  return (
    <div className="flex min-h-full items-center justify-center bg-rim-void p-4">
      <RestoringSessionSplash />
    </div>
  );
}
