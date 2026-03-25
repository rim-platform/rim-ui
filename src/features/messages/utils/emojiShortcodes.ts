const SHORTCODE_MAP: Record<string, string> = {
  // Emoticons
  ":)": "😊",
  ":-)": "😊",
  ":(": "😞",
  ":-(": "😞",
  ":D": "😃",
  ":-D": "😃",
  ";)": "😉",
  ";-)": "😉",
  ":P": "😛",
  ":-P": "😛",
  ":O": "😮",
  ":-O": "😮",
  "<3": "❤️",
  "</3": "💔",
  ":*": "😘",
  "B)": "😎",
  ":/": "😕",
  ":'(": "😢",
  "XD": "😆",
  ":fire:": "🔥",
  ":thumbsup:": "👍",
  ":thumbsdown:": "👎",
  ":heart:": "❤️",
  ":star:": "⭐",
  ":check:": "✅",
  ":x:": "❌",
  ":wave:": "👋",
  ":clap:": "👏",
  ":rocket:": "🚀",
  ":eyes:": "👀",
  ":tada:": "🎉",
  ":100:": "💯",
  ":thinking:": "🤔",
  ":pray:": "🙏",
  ":muscle:": "💪",
  ":warning:": "⚠️",
  ":bug:": "🐛",
  ":bulb:": "💡",
  ":memo:": "📝",
  ":lock:": "🔒",
  ":key:": "🔑",
  ":link:": "🔗",
  ":calendar:": "📅",
  ":clock:": "🕐",
  ":coffee:": "☕",
  ":beer:": "🍺",
  ":pizza:": "🍕",
  ":ok:": "👌",
  ":poop:": "💩",
  ":skull:": "💀",
  ":ghost:": "👻",
  ":laugh:": "😂",
  ":cry:": "😭",
  ":angry:": "😡",
  ":sleep:": "😴",
  ":sick:": "🤢",
  ":cool:": "😎",
  ":nerd:": "🤓",
  ":shrug:": "🤷",
  ":facepalm:": "🤦",
};

/**
 * Replace emoji shortcodes and emoticons in text with actual emoji.
 * Emoticons are matched as whole words (with word boundaries).
 * Shortcodes like :name: are matched anywhere.
 */
export function replaceShortcodes(text: string): string {
  let result = text;

  // Replace :shortcode: patterns first (they're unambiguous)
  for (const [code, emoji] of Object.entries(SHORTCODE_MAP)) {
    if (code.startsWith(":") && code.endsWith(":")) {
      result = result.split(code).join(emoji);
    }
  }

  // Replace emoticons — need to be careful with word boundaries
  // Sort by length descending so longer matches take priority (:-) before :))
  const emoticons = Object.entries(SHORTCODE_MAP)
    .filter(([code]) => !code.startsWith(":") || !code.endsWith(":"))
    .sort((a, b) => b[0].length - a[0].length);

  for (const [emoticon, emoji] of emoticons) {
    // Escape special regex characters
    const escaped = emoticon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match at word boundary or start/end of string
    const regex = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g");
    result = result.replace(regex, (_match, prefix) => prefix + emoji);
  }

  return result;
}

/**
 * Get shortcode suggestions for partial input.
 * Returns matching shortcodes for autocomplete.
 */
export function getShortcodeSuggestions(partial: string): Array<{ code: string; emoji: string }> {
  if (!partial.startsWith(":") || partial.length < 2) return [];
  const lower = partial.toLowerCase();
  return Object.entries(SHORTCODE_MAP)
    .filter(([code]) => code.startsWith(":") && code.endsWith(":") && code.toLowerCase().startsWith(lower))
    .map(([code, emoji]) => ({ code, emoji }))
    .slice(0, 8);
}
