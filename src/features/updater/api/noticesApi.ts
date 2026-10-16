import { resolveResource } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";

/** Where the desktop bundle keeps the third-party licence notices, under its resources. */
export const NOTICES_RESOURCE = "resources/THIRD-PARTY-LICENSES.txt";

/** The same notices as each release attaches them, for the web app. */
export const RELEASE_NOTICES_URL =
  "https://github.com/rim-platform/rim-ui/releases/latest/download/THIRD-PARTY-LICENSES.txt";

/** Opens the bundled third-party licence notices with the system's text viewer. */
export async function openBundledNotices(): Promise<void> {
  await openPath(await resolveResource(NOTICES_RESOURCE));
}
