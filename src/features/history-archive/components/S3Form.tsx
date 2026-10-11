import { useState } from "react";

import { Button } from "../../../shared/ui/Button";
import {
  defaultS3Addressing,
  isRemotePlainHttp,
  type S3Addressing,
  type S3Setup,
} from "../api/historyArchive";
import { InsecureConsent, archiveInputClass as inputClass } from "./formParts";

/**
 * The fields of an S3 bucket: the endpoint, region, bucket and prefix, the access key, and how
 * the bucket is addressed (from the endpoint until the user picks). `onCheck` gets what was
 * typed; the secret goes no further than that call.
 */
export function S3Form({
  busy,
  disabled,
  onCheck,
}: {
  busy: boolean;
  disabled: boolean;
  onCheck: (setup: S3Setup) => void;
}) {
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [chosenAddressing, setAddressing] = useState<S3Addressing | null>(null);
  const [allowInsecure, setAllowInsecure] = useState(false);

  const addressing = chosenAddressing ?? defaultS3Addressing(endpoint);
  const plainHttp = isRemotePlainHttp(endpoint);
  const complete =
    endpoint.trim() !== "" &&
    bucket.trim() !== "" &&
    accessKeyId.trim() !== "" &&
    secretAccessKey !== "";

  const text = (
    label: string,
    value: string,
    set: (value: string) => void,
    placeholder?: string,
  ) => (
    <label className="block text-sm font-medium text-rim-text">
      {label}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => set(e.target.value)}
        className={inputClass}
      />
    </label>
  );

  return (
    <form
      className="space-y-3 rounded-md border border-rim-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete) return;
        onCheck({
          endpoint: endpoint.trim(),
          region: region.trim(),
          bucket: bucket.trim(),
          prefix: prefix.trim(),
          accessKeyId: accessKeyId.trim(),
          secretAccessKey,
          addressing,
          allowInsecure: plainHttp && allowInsecure,
        });
      }}
    >
      <p className="text-xs text-rim-text-muted">
        Any S3-compatible storage: Amazon S3, Cloudflare R2, Backblaze B2, MinIO, Garage. Give the
        key access to this bucket or prefix only. The storage only ever receives encrypted files.
      </p>
      <label className="block text-sm font-medium text-rim-text">
        Endpoint URL
        <input
          type="url"
          value={endpoint}
          placeholder="https://s3.eu-central-1.amazonaws.com"
          onChange={(e) => setEndpoint(e.target.value)}
          className={inputClass}
        />
      </label>
      {plainHttp && (
        <InsecureConsent
          checked={allowInsecure}
          onChange={setAllowInsecure}
          secret="the access key ID"
        />
      )}
      {text("Region", region, setRegion, "us-east-1 (Cloudflare R2: auto)")}
      {text("Bucket", bucket, setBucket)}
      {text("Prefix", prefix, setPrefix, "Optional, for example rim/ada")}
      <label className="block text-sm font-medium text-rim-text">
        Addressing
        <select
          value={addressing}
          onChange={(e) => setAddressing(e.target.value as S3Addressing)}
          className={inputClass}
        >
          <option value="path">Path-style (endpoint/bucket)</option>
          <option value="virtualHost">Virtual-hosted (bucket.endpoint)</option>
        </select>
      </label>
      {text("Access key ID", accessKeyId, setAccessKeyId)}
      <label className="block text-sm font-medium text-rim-text">
        Secret access key
        <input
          type="password"
          autoComplete="off"
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          className={inputClass}
        />
      </label>
      <Button type="submit" size="sm" disabled={!complete || disabled} isLoading={busy}>
        Check bucket
      </Button>
    </form>
  );
}
