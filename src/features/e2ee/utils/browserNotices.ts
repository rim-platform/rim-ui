/** Why this browser cannot read an encrypted conversation, by send block. */
export const BROWSER_NOTICES: Record<string, string> = {
  noDeviceKey: "Set up this browser as a linked device to read encrypted conversations",
  unsupported: "This browser cannot run encrypted conversations",
  otherTab:
    "Encrypted conversations are open in another tab of this browser. Close it to read them here.",
};
