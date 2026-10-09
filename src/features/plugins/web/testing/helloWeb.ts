// The plugin of "A web plugin without the SDK" in the web plugins spec: its
// manifest and entry module exactly as appendix A bundles them. Tests run it on
// a real MessageChannel as a plugin written without the SDK.

export const HELLO_WEB_MANIFEST =
  '{"manifest_version":1,"plugin_id":"dev.example.hello-web","display_name":"Hello Web","version":"0.1.0","description":"Says hello from a sandboxed frame.","runtime_kind":"WebSandboxed","entrypoint":"main.mjs","commands":[{"id":"greet","title":"Hello Web: Greet","description":"Greets the signed-in user."}]}';

export const HELLO_WEB_MAIN = [
  "const port = globalThis.rimPluginPort;",
  'const ID = "dev.example.hello-web";',
  'const send = (m) => port.postMessage(JSON.stringify({ jsonrpc: "2.0", ...m }));',
  "let who = null;",
  "port.onmessage = (event) => {",
  "  let m;",
  "  try { m = JSON.parse(event.data); } catch { return; }",
  "  const p = m.params ?? {};",
  "  switch (m.method) {",
  '    case "rim.handshake": {',
  "      const ok = p.supportedVersions?.includes(1) && p.pluginId === ID;",
  "      who = p.principal;",
  "      send({ id: m.id, result: { accepted: ok, protocolVersion: 1, pluginId: ID } });",
  "      break;",
  "    }",
  '    case "rim.heartbeat":',
  "      send({ id: m.id, result: {} });",
  "      break;",
  '    case "rim.principal.changed":',
  "      who = p.principal;",
  "      break;",
  '    case "rim.command.execute":',
  '      if (p.commandId === "greet") send({ id: m.id, result: { payload: `Hello, ${who?.displayName ?? "world"}!` } });',
  "      else send({ id: m.id, error: { code: -32602, message: `unknown command: ${p.commandId}` } });",
  "      break;",
  "    default:",
  "      if (m.id != null && m.method) send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });",
  "  }",
  "};",
  "",
].join("\n");

/** SHA-256 of the bundle of the two files above. */
export const HELLO_WEB_BUNDLE_SHA256 =
  "5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85";
