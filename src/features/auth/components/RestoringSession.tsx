/** Full-page placeholder for the auth routes while a session cookie is being checked. */
export function RestoringSession() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-rim-void p-4">
      <p className="text-sm text-rim-text-muted">Restoring session...</p>
    </div>
  );
}
