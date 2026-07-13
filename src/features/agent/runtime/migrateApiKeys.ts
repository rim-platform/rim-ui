/**
 * One-shot migration: copy API keys from Stronghold (legacy Phase 4 store)
 * to the OS keyring (Phase 5 / Option B).
 *
 * Strategy (§5.2 option b of the agent-settings-consolidation decision):
 *   For each known provider, check whether the OS keyring already has a key.
 *   If not, check Stronghold. If Stronghold has a key and the keyring does not,
 *   copy it across via `set_provider_key` then delete it from Stronghold.
 *
 * Idempotency: the migration sets `rim-keyring-migration-v1` in localStorage
 * to `"done"` after a successful run. Subsequent boots skip it entirely.
 * On any error the flag is NOT set so the next boot retries.
 *
 * Scope: desktop only — gated on `capabilities.agent` by the caller
 * (`App.tsx` early effect). The web build never runs this module.
 */

import { invoke } from "@tauri-apps/api/core";

import { loadApiKey, deleteApiKey } from "./keyStore";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast/useToastStore";

const MIGRATION_FLAG = "rim-keyring-migration-v1";
const PROVIDERS = ["anthropic", "openai"] as const;

type Provider = (typeof PROVIDERS)[number];

/**
 * Run the Stronghold → OS keyring migration once per device.
 *
 * Safe to call unconditionally at app boot from a Tauri-capable context.
 * Returns immediately if the migration has already run (flag is set in
 * localStorage). Emits a single `toast.info` when at least one key was
 * migrated successfully.
 *
 * Errors are logged via `core/logger` and do NOT set the flag, so the next
 * boot will retry. A per-provider failure does NOT prevent other providers
 * from migrating.
 */
export async function migrateApiKeysOnce(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG) === "done") return;

  let migratedAny = false;
  let anyError = false;

  for (const provider of PROVIDERS) {
    try {
      const copied = await migrateProvider(provider);
      if (copied) migratedAny = true;
    } catch (err) {
      // Only `MigrationError` (thrown when `set_provider_key` fails) reaches here.
      if (err instanceof MigrationError) {
        anyError = true;
        logger.error(
          `[migrateApiKeys] Migration failed for provider "${provider}": ${err.message}`,
          { target: "security", error: err },
        );
      }
    }
  }

  // Only mark done if no provider errored.
  if (!anyError) {
    localStorage.setItem(MIGRATION_FLAG, "done");
  }

  if (migratedAny) {
    toast.info("Migrated API keys to OS keyring.");
  }
}

// ──────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────

/** Sentinel error for migration failures (as distinct from "nothing to do"). */
class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Migrate a single provider.
 *
 * Returns `true` when a key was successfully copied from Stronghold to the
 * OS keyring. Returns `false` when the migration was a no-op (keyring already
 * set, or nothing in Stronghold). Throws `MigrationError` when
 * `set_provider_key` fails so the caller can track the error and skip setting
 * the idempotency flag.
 */
async function migrateProvider(provider: Provider): Promise<boolean> {
  // Step 1: check keyring.
  const inKeyring = await invoke<boolean>("is_provider_key_configured", { provider });
  if (inKeyring) {
    // Already in keyring — nothing to do.
    return false;
  }

  // Step 2: check Stronghold.
  const inStronghold = await loadApiKey(provider);
  if (!inStronghold) {
    // Nothing in Stronghold either — new install or already cleaned up.
    return false;
  }

  // Step 3: copy to keyring.
  try {
    await invoke<void>("set_provider_key", { provider, apiKey: inStronghold });
  } catch (err) {
    throw new MigrationError(err instanceof Error ? err.message : String(err));
  }

  // Step 4: remove Stronghold entry (best-effort — failure is acceptable).
  try {
    await deleteApiKey(provider);
  } catch (err) {
    // Log but do not rethrow — the key is now in the keyring which is the
    // authoritative store. A stale Stronghold entry is harmless (it is
    // encrypted at rest and the next migration run will skip step 1 because
    // the keyring now has the key).
    logger.error(
      `[migrateApiKeys] Could not delete Stronghold entry for "${provider}" after copy: ${err instanceof Error ? err.message : String(err)}`,
      { target: "security", error: err },
    );
  }

  return true;
}
