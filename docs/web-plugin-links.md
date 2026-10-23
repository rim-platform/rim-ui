# Installing plugins from links in the browser

Paste the HTTPS bundle URL with its `#sha256=<64 lowercase hex>` pin. The browser requests
it through the configured RIM server using the current session and CSRF protection, then
checks the bytes against the pin again. External hosts do not need browser CORS headers.

The server must support `plugin_link_fetch` and have it enabled. It enforces public HTTPS
addresses, redirect and download limits, and validates the pin and bundle structure. The
client explains an older server, disabled feature, invalid bundle, rate limit or connection
failure. An older server needs an update to install these links in the browser.

Desktop external downloads continue through the desktop host. Workspace-hosted bundle
copies still use the existing authenticated download route.
