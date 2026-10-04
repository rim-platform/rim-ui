/**
 * Hello World plugin panel — app.js
 *
 * Uses the raw postMessage bridge (no SDK — that ships in Phase 3).
 * On button click sends `rim.ui.notification.show` to the host, which
 * requires the `ui.notify` capability to be approved by the user.
 *
 * Note: the `ui.notify` bridge handler currently logs to the console
 * (Phase 2 wires the real notification side-effect).  The observable
 * proof-of-life for Phase 1 is the spawn→handshake cycle in the host log.
 */

const output = document.getElementById("output");
const btn = document.getElementById("greet-btn");

// Listen for messages from the host (e.g. theme changes, panel state).
window.addEventListener("message", function (event) {
  if (!event.data || typeof event.data.type !== "string") return;

  if (event.data.type === "theme.changed") {
    // Theme sync — no-op for this minimal panel.
  } else if (event.data.type === "panel.state_update") {
    if (event.data.state && event.data.state.lastGreeting) {
      output.textContent = "Last greeting: " + event.data.state.lastGreeting;
    }
  }
});

btn.addEventListener("click", function () {
  const greeting = "Hello from hello-world plugin! (" + new Date().toLocaleTimeString() + ")";
  output.textContent = "Sent: " + greeting;

  // Send a notification request to the host.
  // Requires `ui.notify` capability to be approved.
  // The host's pluginBridge.ts handles this message type.
  window.parent.postMessage(
    {
      type: "rim.ui.notification.show",
      title: "Hello World",
      body: greeting,
    },
    "*",
  );
});
