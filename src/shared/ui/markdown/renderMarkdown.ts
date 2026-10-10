import DOMPurify from "dompurify";
import type { DOMPurify as Purifier } from "dompurify";
import { Marked } from "marked";
import type { RendererObject, Tokens } from "marked";

import {
  MENTION_CLASS,
  postprocessMentions,
  preprocessMentions,
} from "../../utils/mentionRenderer";
import { isSafeLinkUrl, isSafeMediaUrl } from "./safeUrl";

/** Highlights code in a language; null when the language is not known. */
export type Highlighter = (code: string, language: string) => string | null;

export interface RenderMarkdownOptions {
  /** userId -> displayName map for resolving `<@userId>` mention tokens. */
  memberMap?: Map<string, string>;
  /** Custom emoji name -> image URL map for resolving `:name:` shortcodes. */
  customEmojiMap?: Map<string, string>;
  /** Syntax highlighter for fenced code blocks; without it code renders plain. */
  highlight?: Highlighter | null;
  /** Markdown images render inline when true, as links when false. */
  showInlineMedia?: boolean;
}

const LINK_CLASS = "text-rim-accent hover:underline";
const EMOJI_CLASS = "inline-block h-5 w-5 align-text-bottom object-contain";
const IMAGE_CLASS = "rim-md-image";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "a",
  "span",
  "img",
];

const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "class",
  "data-user-id",
  "tabindex",
  "role",
  "src",
  "alt",
  "title",
];

/** Class names the renderer itself produces; any other class is dropped. */
const ALLOWED_CLASSES = new Set(
  [LINK_CLASS, EMOJI_CLASS, MENTION_CLASS, IMAGE_CLASS, "hljs"].flatMap((c) => c.split(" ")),
);
/** highlight.js scopes (`hljs-title`, `class_`) and fenced-code languages (`language-ts`). */
const ALLOWED_CLASS_PATTERNS = [/^hljs-[a-z0-9_-]+$/, /^[a-z]+_+$/, /^language-[a-z0-9_+#.-]+$/];

function isAllowedClass(name: string): boolean {
  return ALLOWED_CLASSES.has(name) || ALLOWED_CLASS_PATTERNS.some((p) => p.test(name));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The language of a fenced block's info string, when it is a plausible language name. */
function codeLanguage(info: string | undefined): string | null {
  const word = (info ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z0-9_+#.-]{1,32}$/.test(word) ? word : null;
}

function linkHtml(href: string, inner: string, title?: string | null): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${titleAttr} class="${LINK_CLASS}">${inner}</a>`;
}

function createRenderer(
  highlight: Highlighter | null,
  showInlineMedia: boolean,
): RendererObject<string, string> {
  return {
    code({ text, lang, escaped }: Tokens.Code) {
      const language = codeLanguage(lang);
      const highlighted = language && highlight && !escaped ? highlight(text, language) : null;
      const body = highlighted ?? (escaped ? text : escapeHtml(text));
      const classes = language ? `${highlighted ? "hljs " : ""}language-${language}` : "";
      const classAttr = classes ? ` class="${classes}"` : "";
      return `<pre><code${classAttr}>${body}</code></pre>\n`;
    },
    link({ href, title, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      return isSafeLinkUrl(href) ? linkHtml(href, inner, title) : inner;
    },
    image({ href, title, text }: Tokens.Image) {
      if (!showInlineMedia) {
        return isSafeLinkUrl(href)
          ? linkHtml(href, escapeHtml(text || href), title)
          : escapeHtml(text);
      }
      if (!isSafeMediaUrl(href)) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr} class="${IMAGE_CLASS}">`;
    },
  };
}

/** Key for the instances that render code without a highlighter. */
const plainCode: Highlighter = () => null;
const markedInstances = new WeakMap<Highlighter, Map<boolean, Marked>>();

/** One Marked instance per highlighter and media choice, created on first use. */
function markedFor(highlight: Highlighter | null, showInlineMedia: boolean): Marked {
  const key = highlight ?? plainCode;
  let byMedia = markedInstances.get(key);
  if (!byMedia) {
    byMedia = new Map();
    markedInstances.set(key, byMedia);
  }
  let instance = byMedia.get(showInlineMedia);
  if (!instance) {
    instance = new Marked({ renderer: createRenderer(highlight, showInlineMedia) });
    byMedia.set(showInlineMedia, instance);
  }
  return instance;
}

let purifier: Purifier | null = null;

/**
 * A DOMPurify instance of its own: links and images keep only safe URLs, classes only the
 * renderer's own, links open in a new context, images load lazily without a referrer.
 */
function getPurifier(): Purifier {
  if (purifier) return purifier;
  const instance = DOMPurify(window);
  instance.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName === "href") {
      if (!isSafeLinkUrl(data.attrValue)) data.keepAttr = false;
    } else if (data.attrName === "src") {
      if (!isSafeMediaUrl(data.attrValue)) data.keepAttr = false;
    } else if (data.attrName === "class") {
      const kept = data.attrValue.split(/\s+/).filter(isAllowedClass).join(" ");
      if (kept) data.attrValue = kept;
      else data.keepAttr = false;
    }
  });
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } else if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("decoding", "async");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
  purifier = instance;
  return instance;
}

/** Replace `:custom_name:` shortcodes with inline emoji images. */
function replaceCustomEmoji(html: string, emojiMap: Map<string, string>): string {
  return html.replace(/:([a-zA-Z0-9_-]+):/g, (match, name: string) => {
    const url = emojiMap.get(name);
    if (!url) return match;
    return `<img src="${escapeHtml(url)}" alt=":${name}:" title=":${name}:" class="${EMOJI_CLASS}" />`;
  });
}

/** Markdown to sanitised HTML: mentions, custom emoji, highlighted code, safe links and images. */
export function renderMarkdown(content: string, options: RenderMarkdownOptions = {}): string {
  const { memberMap, customEmojiMap, highlight = null, showInlineMedia = true } = options;
  let text = content;
  let mentions: Array<{ userId: string; displayName: string }> = [];
  if (memberMap && memberMap.size > 0) {
    const pre = preprocessMentions(text, memberMap);
    text = pre.text;
    mentions = pre.mentions;
  }

  let html = markedFor(highlight, showInlineMedia).parse(text, { async: false }) as string;
  if (mentions.length > 0) html = postprocessMentions(html, mentions);
  if (customEmojiMap && customEmojiMap.size > 0) html = replaceCustomEmoji(html, customEmojiMap);

  return getPurifier().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}
