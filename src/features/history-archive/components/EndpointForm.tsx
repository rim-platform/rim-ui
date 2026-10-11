import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import type { EndpointAuth, EndpointSetup } from "../api/historyArchive";

const inputClass =
  "mt-2 w-full rounded-md border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40";

type AuthMode = EndpointAuth["mode"];

const AUTH_MODES: { mode: AuthMode; label: string }[] = [
  { mode: "none", label: "None" },
  { mode: "basic", label: "User name and password" },
  { mode: "bearer", label: "Token (Authorization: Bearer)" },
  { mode: "header", label: "Token in a header you name" },
];

/** Plain HTTP to a host other than this computer, which the check refuses unless allowed. */
function isRemotePlainHttp(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  return !(host === "localhost" || host === "::1" || /^127\./.test(host));
}

/**
 * The fields of a backup endpoint: its URL, how requests authenticate, and the password or
 * token. `onCheck` gets what was typed; the secret goes no further than that call.
 */
export function EndpointForm({
  busy,
  disabled,
  onCheck,
}: {
  busy: boolean;
  disabled: boolean;
  onCheck: (setup: EndpointSetup) => void;
}) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<AuthMode>("none");
  const [username, setUsername] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [secret, setSecret] = useState("");
  const [allowInsecure, setAllowInsecure] = useState(false);

  const plainHttp = isRemotePlainHttp(url);
  const complete =
    url.trim() !== "" &&
    (mode === "none" || secret !== "") &&
    (mode !== "basic" || username.trim() !== "") &&
    (mode !== "header" || headerName.trim() !== "");

  function auth(): EndpointAuth {
    switch (mode) {
      case "basic":
        return { mode, username: username.trim() };
      case "header":
        return { mode, name: headerName.trim() };
      default:
        return { mode };
    }
  }

  return (
    <form
      className="space-y-3 rounded-md border border-rim-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete) return;
        onCheck({
          url: url.trim(),
          auth: auth(),
          secret: mode === "none" ? null : secret,
          allowInsecure: plainHttp && allowInsecure,
        });
      }}
    >
      <p className="text-xs text-rim-text-muted">
        A service of your own that stores files: <span className="font-mono">GET</span> and{" "}
        <span className="font-mono">POST</span> on one <span className="font-mono">/backup</span>{" "}
        URL. It only ever receives encrypted files.
      </p>
      <label className="block text-sm font-medium text-rim-text">
        Endpoint URL
        <input
          type="url"
          value={url}
          placeholder="https://backup.example.com/backup"
          onChange={(e) => setUrl(e.target.value)}
          className={inputClass}
        />
      </label>
      {plainHttp && (
        <label className="flex items-start gap-2 text-xs text-rim-text-muted">
          <input
            type="checkbox"
            checked={allowInsecure}
            onChange={(e) => setAllowInsecure(e.target.checked)}
            className="mt-0.5 accent-rim-accent"
          />
          <span>
            Allow an unencrypted connection. The archive stays encrypted, but the password or token
            travels in the clear: only on a network you trust.
          </span>
        </label>
      )}
      <label className="block text-sm font-medium text-rim-text">
        Sign-in
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as AuthMode)}
          className={inputClass}
        >
          {AUTH_MODES.map(({ mode: value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {mode === "basic" && (
        <label className="block text-sm font-medium text-rim-text">
          User name
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
          />
        </label>
      )}
      {mode === "header" && (
        <label className="block text-sm font-medium text-rim-text">
          Header name
          <input
            type="text"
            value={headerName}
            placeholder="X-Api-Key"
            onChange={(e) => setHeaderName(e.target.value)}
            className={inputClass}
          />
        </label>
      )}
      {mode !== "none" && (
        <label className="block text-sm font-medium text-rim-text">
          {mode === "basic" ? "Password" : "Token"}
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className={inputClass}
          />
        </label>
      )}
      <Button type="submit" size="sm" disabled={!complete || disabled} isLoading={busy}>
        Check endpoint
      </Button>
    </form>
  );
}
