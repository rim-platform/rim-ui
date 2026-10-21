/**
 * The optional server features this client knows (`serverInfo.features[].key`), their names
 * as the UI shows them, and the error a REST route answers while one is off.
 */

/** A feature key the client knows; the server may list others, which the client ignores. */
export type ServerFeatureKey =
  | "attachments"
  | "link_previews"
  | "email"
  | "custom_emoji"
  | "workspace_plugins"
  | "ai_commands"
  | "avatars";

/** Each known feature's name, in the order the server lists them. */
export const SERVER_FEATURE_LABELS: Record<ServerFeatureKey, string> = {
  attachments: "Attachments",
  link_previews: "Link previews",
  email: "Email",
  custom_emoji: "Custom emoji",
  workspace_plugins: "Workspace plugins",
  ai_commands: "AI commands",
  avatars: "Profile pictures",
};

/** The features whose name is a plural, so a sentence about them says "are". */
const PLURAL: ReadonlySet<string> = new Set([
  "attachments",
  "link_previews",
  "workspace_plugins",
  "ai_commands",
  "avatars",
]);

/** Whether `key` names a feature this client knows. */
export function isKnownServerFeature(key: string): key is ServerFeatureKey {
  return Object.prototype.hasOwnProperty.call(SERVER_FEATURE_LABELS, key);
}

/** The feature's name for the UI; an unknown key reads as itself. */
export function serverFeatureLabel(key: string): string {
  return isKnownServerFeature(key) ? SERVER_FEATURE_LABELS[key] : key;
}

function verbFor(key: string): string {
  return PLURAL.has(key) ? "are" : "is";
}

/** "<Feature> is switched off on this server": the operator disabled it. */
export function featureOffMessage(key: string): string {
  return `${serverFeatureLabel(key)} ${verbFor(key)} switched off on this server`;
}

/** "<Feature> is not set up on this server": its configuration is missing. */
export function featureUnavailableMessage(key: string): string {
  return `${serverFeatureLabel(key)} ${verbFor(key)} not set up on this server`;
}

/** A REST route refused the request because `feature` is not enabled on the server. */
export class FeatureDisabledError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(featureOffMessage(feature));
    this.name = "FeatureDisabledError";
    this.feature = feature;
  }
}

/**
 * The `FeatureDisabledError` a REST answer carries: a 403 whose JSON body has
 * `code: "FEATURE_DISABLED"` and the `feature`. `null` for any other answer. Reads a clone, so
 * the caller can still read the body.
 */
export async function featureDisabledFromResponse(
  response: Response,
): Promise<FeatureDisabledError | null> {
  if (response.status !== 403) return null;
  try {
    const body = (await response.clone().json()) as { code?: unknown; feature?: unknown };
    if (body.code === "FEATURE_DISABLED" && typeof body.feature === "string") {
      return new FeatureDisabledError(body.feature);
    }
  } catch {
    // Not JSON: some other 403.
  }
  return null;
}
