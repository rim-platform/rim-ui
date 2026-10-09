/** The caveat of keeping a device key in a browser, shown next to the web app's key actions. */
export function BrowserKeyNotice() {
  return (
    <p className="text-xs text-rim-text-faint">
      Keys kept in a browser are weaker than on a desktop: the key cannot be copied out, but a
      malicious extension or a compromised page can sign in with it while the page is open, and
      clearing this site&apos;s data deletes it.
    </p>
  );
}
