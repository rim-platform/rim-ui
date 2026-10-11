import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import { isRemotePlainHttp, type EndpointAuth, type EndpointSetup } from "../api/historyArchive";
import { InsecureConsent, archiveInputClass as inputClass } from "./formParts";

type AuthMode = EndpointAuth["mode"];

const AUTH_MODES: { mode: AuthMode; label: string }[] = [
  { mode: "none", label: "None" },
  { mode: "basic", label: "User name and password" },
  { mode: "bearer", label: "Token (Authorization: Bearer)" },
  { mode: "header", label: "Token in a header you name" },
];

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
        <InsecureConsent
          checked={allowInsecure}
          onChange={setAllowInsecure}
          secret="the password or token"
        />
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
