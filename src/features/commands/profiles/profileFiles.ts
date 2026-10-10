import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { AppPlatform } from "../../../core/runtime/runtime";
import { profileFileName, serializeKeybindProfile, type KeybindProfile } from "./keybindProfile";

/** Largest profile file read; the desktop's native dialog applies the same limit. */
export const MAX_PROFILE_FILE_BYTES = 256 * 1024;

/**
 * Save the profile as a file: through the native save dialog on the desktop, as a download
 * on the web. Returns where it went, or `null` when the user cancelled the dialog.
 */
export async function saveProfileFile(
  profile: KeybindProfile,
  platform: AppPlatform,
): Promise<string | null> {
  const fileName = profileFileName(profile);
  const contents = serializeKeybindProfile(profile);
  if (platform === "desktop") {
    const result = await safeInvoke<string | null>("keybind_profile_save", { fileName, contents });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return fileName;
}

/** Ask for a profile file through the desktop's native dialog; `null` when cancelled. */
export async function openProfileFileOnDesktop(): Promise<string | null> {
  const result = await safeInvoke<string | null>("keybind_profile_open", {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** The text of a profile file the user picked in the browser. */
export async function readProfileFile(file: File): Promise<string> {
  if (file.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error(
      `${file.name} is larger than ${MAX_PROFILE_FILE_BYTES / 1024} KiB, too large for a keybind profile.`,
    );
  }
  return file.text();
}
