// Publishing a signed statement to a workspace's registry: its bundle goes to the server's
// copy first, then the entry is added, or updated when the plugin id is already there.

import type {
  SignedStatementInput,
  WorkspacePluginStatus,
} from "../../../core/graphql/generated/schema-types";
import type { PluginManifestStatement } from "../../key-identity/browser/pluginManifest";
import {
  addWorkspacePlugin,
  updateWorkspacePlugin,
  uploadPluginBundle,
  type RegistryEntry,
} from "./api";
import { checkBundleBytes } from "./verify";

export interface Publication {
  serverId: string;
  statement: SignedStatementInput;
  /** The statement as verified on this device. */
  signed: PluginManifestStatement;
  status: WorkspacePluginStatus;
  publisherKeyLog: SignedStatementInput[];
  /** The bundle file, for a bundle source. */
  bundle?: Uint8Array;
  /** The entry this statement replaces, when the registry has the plugin id. */
  existing?: RegistryEntry;
}

/** Upload the bundle, if any, then add or update the entry. */
export async function publishStatement(publication: Publication): Promise<RegistryEntry> {
  const { serverId, statement, signed, status, publisherKeyLog, existing } = publication;
  if (signed.source.kind === "bundle") {
    if (!publication.bundle) throw new Error("Choose the plugin's .rimbundle to publish it.");
    await checkBundleBytes(signed, publication.bundle);
    const uploaded = await uploadPluginBundle(serverId, publication.bundle);
    if (uploaded.sha256 !== signed.source.sha256) {
      throw new Error("The server stored another bundle than the signed one.");
    }
  }
  return existing
    ? updateWorkspacePlugin({
        serverId,
        pluginId: signed.pluginId,
        statement,
        status,
        publisherKeyLog,
      })
    : addWorkspacePlugin({ serverId, statement, status, publisherKeyLog });
}
