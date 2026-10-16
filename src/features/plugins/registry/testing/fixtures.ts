// Registry entries, checks and installed plugins for tests.

import {
  PluginRuntimeKind,
  PluginSignatureStatus,
  PluginSourceKind,
  WorkspacePluginStatus,
} from "../../../../core/graphql/generated/schema-types";
import type { PluginManifestStatement } from "../../../key-identity/browser/pluginManifest";
import type { PluginInfo } from "../../types";
import { parseManifestText } from "../../../../../sdk/plugin-sdk/src/manifestRules";
import { HELLO_WEB_MANIFEST } from "../../web/testing/helloWeb";
import type { RegistryEntry } from "../api";
import type { VerifiedEntry } from "../verify";
import { INCEPTION, PUBLISHER, SIGNED_HELLO_WEB } from "./signedHelloWeb";

export const SERVER = "11111111-1111-1111-1111-111111111111";
export const ENDPOINT = "http://localhost:8080/api";
export const SHA = "5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85";

/** Appendix A as a registry entry of `SERVER`. */
export function helloEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: "e1",
    serverId: SERVER,
    pluginId: "dev.example.hello-web",
    version: "0.1.0",
    displayName: "Hello Web",
    runtimeKind: PluginRuntimeKind.WEB_SANDBOXED,
    status: WorkspacePluginStatus.RECOMMENDED,
    source: {
      kind: PluginSourceKind.BUNDLE,
      bundleUrl: `/api/plugin-bundles/${SERVER}/${SHA}`,
      bundleSha256: SHA,
      bundleSize: 1605,
    },
    manifest: HELLO_WEB_MANIFEST,
    statement: SIGNED_HELLO_WEB,
    publisherPrincipalId: PUBLISHER,
    publisherName: "Ada",
    publisherKeySeq: 0,
    publisherKeyLog: [INCEPTION],
    signatureStatus: PluginSignatureStatus.VALID,
    approvedBy: null,
    approvedAt: "2026-10-09T00:00:00Z",
    updatedAt: "2026-10-09T00:00:00Z",
    ...overrides,
  };
}

export const HELLO_STATEMENT: PluginManifestStatement = {
  principalId: PUBLISHER,
  keySeq: 0,
  publisherName: "Ada",
  pluginId: "dev.example.hello-web",
  version: "0.1.0",
  manifest: HELLO_WEB_MANIFEST,
  displayName: "Hello Web",
  runtimeKind: "WebSandboxed",
  source: { kind: "bundle", sha256: SHA, size: 1605 },
  issuedAt: "2026-10-09T00:00:00Z",
};

/** A verified check of `entry`, with a manifest built from `manifest` when given. */
export function verified(
  overrides: { entry?: RegistryEntry; manifest?: string; hash?: string } = {},
): VerifiedEntry {
  const manifest = overrides.manifest ?? HELLO_WEB_MANIFEST;
  return {
    ok: true,
    entry: overrides.entry ?? helloEntry(),
    statement: { ...HELLO_STATEMENT, manifest },
    validity: { status: "valid" },
    manifest: parseManifestText(manifest),
    statementSha256: overrides.hash ?? "a".repeat(64),
  };
}

/** Hello Web as installed from `SERVER`'s registry at statement `hash`. */
export function installedHello(
  overrides: Partial<PluginInfo> = {},
  hash = "0".repeat(64),
): PluginInfo {
  return {
    plugin_id: "dev.example.hello-web",
    manifest_id: "dev.example.hello-web",
    display_name: "Hello Web",
    version: "0.0.9",
    description: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    runtime_kind: "WebSandboxed",
    source: {
      kind: "registry",
      endpoint: ENDPOINT,
      serverId: SERVER,
      pluginId: "dev.example.hello-web",
      statementSha256: hash,
      publisherPrincipalId: PUBLISHER,
    },
    ...overrides,
  };
}
