/**
 * Comment hygiene across the TypeScript, JavaScript and Rust sources of this repository: no
 * comment carries history, a pointer to a doc, a plan, ticket or pull request reference, a
 * reviewer finding id, a leftover task marker, the first-person plural voice of a design note,
 * a section sign or a persona name. Comments say what the code is and does. Generated and
 * vendored output is not scanned.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/** A class of text no comment may contain. */
interface Token {
  /** The name a failure shows for this class. */
  name: string;
  /**
   * The regular expression that finds it in a comment line. When it has a capture group, a
   * failure shows that group instead of the whole match.
   */
  pattern: RegExp;
  /** Whether text inside backtick code spans and fenced code blocks is exempt. */
  proseOnly: boolean;
}

/** Every banned token class, in the order a failure lists them. */
const TOKENS: Token[] = [
  { name: "section sign", pattern: /§/, proseOnly: false },
  {
    name: "persona name",
    pattern: /Fury|Widow|Hulk|Iron[ -]?Man|Hawkeye|Strange|Falcon|Tony|Spider-Man|Ant-Man/,
    proseOnly: false,
  },
  { name: "Phase N", pattern: /Phase \d/, proseOnly: false },
  { name: "Track N", pattern: /Track \d/, proseOnly: false },
  {
    name: "Stage N",
    pattern: /(?<![Mm]ulti-)\bStage \d(?!\s+(?:build|image|container|Docker))/,
    proseOnly: false,
  },
  { name: "plan item id", pattern: /P\d-[A-Z]\d/, proseOnly: false },
  { name: "master plan", pattern: /\bmaster plan\b/i, proseOnly: false },
  {
    name: "finding id",
    pattern: /(?<![%#])\b(?:[NFHLMC]\d|S-H\d|A-H\d)\b/,
    proseOnly: true,
  },
  {
    name: "design-note voice",
    pattern: /\b(?:[Ww][Ee]|[Oo][Uu][Rr](?:[Ss]|[Ss][Ee][Ll][Vv][Ee][Ss])?)\b|\b[Uu]s\b/,
    proseOnly: true,
  },
  { name: "legacy", pattern: /\blegacy\b/i, proseOnly: true },
  { name: "follow-up", pattern: /\bfollow-?ups?\b/i, proseOnly: true },
  { name: "previously", pattern: /\bpreviously\b/i, proseOnly: true },
  {
    name: "used to",
    pattern: /\b(?:it|this|that|they|which|who|we|there)\s+used\s+to\b|\bused\s+to\s+be\b/i,
    proseOnly: true,
  },
  { name: "task marker", pattern: /\b(?:TODO|FIXME)\b/, proseOnly: true },
  { name: "pull request number", pattern: /\bPRs?\s*#?\d+/, proseOnly: true },
  { name: "issue reference", pattern: /(?:^|[^\w&:#])(#\d+)(?!\w)/, proseOnly: true },
  { name: "finding label", pattern: /\bFL\d+/, proseOnly: true },
  { name: "docs pointer", pattern: /\bsee\s+`?docs\//i, proseOnly: false },
  { name: "spec section", pattern: /\bspec(?:ification)?\s+section\b/i, proseOnly: true },
];

/** A backtick code span on one line. */
const CODE_SPAN = /`[^`\n]*`/g;

/** One line of comment text: its 1-based source line and the text after the opener. */
type CommentLine = [line: number, text: string];

/** One banned token found in a comment. */
interface Offence {
  /** The 1-based source line the comment text is on. */
  line: number;
  /** The name of the token class. */
  token: string;
  /** The text that matched. */
  found: string;
}

/** The language a source file is lexed as. */
type Language = "ts" | "tsx" | "rust";

/** Directories scanned for TypeScript and JavaScript, relative to the repository root. */
const SCRIPT_ROOTS = [
  "src",
  "sdk/plugin-sdk/src",
  "sdk/plugin-sdk/test",
  "sdk/plugin-sdk/scripts",
  "plugins",
  "scripts",
  "src-tauri/src",
  "eslint.config.js",
  "codegen.mjs",
  "vite.config.ts",
  "vitest.config.ts",
];

/** Directories scanned for Rust, relative to the repository root. */
const RUST_ROOTS = ["src-tauri/src", "src-tauri/build.rs", "src-tauri/crates"];

/** Generated or vendored paths, relative to the repository root, that are never scanned. */
const EXCLUDED_PATHS = [
  "src/core/graphql/generated",
  "sdk/plugin-sdk/src/generated",
  "src/features/e2ee/wasm/rim_mls_wasm.js",
  "src/features/e2ee/wasm/rim_mls_wasm.d.ts",
  "src/features/e2ee/wasm/rim_mls_wasm_bg.wasm.d.ts",
  "src/features/auth/opaque/wasm/rim_opaque_wasm.js",
  "src/features/auth/opaque/wasm/rim_opaque_wasm.d.ts",
  "src/features/auth/opaque/wasm/rim_opaque_wasm_bg.wasm.d.ts",
  "src-tauri/gen",
];

/** Directory names never descended into. */
const EXCLUDED_DIRS = new Set(["node_modules", "dist", "target"]);

/** File extensions lexed as TypeScript or JavaScript, with whether JSX is allowed. */
const SCRIPT_EXTENSIONS: Record<string, Language> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "ts",
  ".mjs": "ts",
  ".cjs": "ts",
  ".tsx": "tsx",
  ".jsx": "tsx",
};

/** Keywords after which a `/` starts a regular expression and a `<` starts a JSX element. */
const EXPRESSION_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "instanceof",
  "yield",
  "await",
]);

/**
 * Every banned token in the comments of `source`.
 *
 * Prose-only token classes skip backtick code spans and the lines of fenced code blocks inside
 * a run of comment lines.
 */
function offences(source: string, language: Language): Offence[] {
  const found: Offence[] = [];
  let inFence = false;
  let previousLine = 0;
  const lines = language === "rust" ? rustComments(source) : scriptComments(source, language);
  for (const [line, text] of lines) {
    if (line !== previousLine + 1 && line !== previousLine) inFence = false;
    previousLine = line;
    const fenceMarker = text.trimStart().replace(/^[/!*]+/, "");
    const isFence = fenceMarker.trimStart().startsWith("```");
    if (isFence) inFence = !inFence;
    const prose = isFence || inFence ? "" : text.replace(CODE_SPAN, " ");
    for (const token of TOKENS) {
      const match = token.pattern.exec(token.proseOnly ? prose : text);
      if (match) found.push({ line, token: token.name, found: match[1] ?? match[0] });
    }
  }
  return found;
}

/**
 * A function from a character index in `source` to its 1-based line number.
 */
function lineIndex(source: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Every comment in the TypeScript or JavaScript `source` as its line number and the text after
 * the comment opener, one entry per source line a comment covers: `//` lines and trailing
 * comments, `/* *\/` and `/** *\/` blocks, and JSX `{/* *\/}` comments when `language` is
 * `tsx`.
 *
 * String, template and regular expression literals are skipped, so a `//` inside one does not
 * open a comment. A `/` divides when the token before it ends an expression and opens a regular
 * expression otherwise; in `tsx`, a `<` followed by a letter or `>` where an expression may
 * start opens a JSX element, whose text children are not code.
 */
function scriptComments(source: string, language: Language): CommentLine[] {
  const out: CommentLine[] = [];
  const lineAt = lineIndex(source);
  const n = source.length;
  const jsx = language === "tsx";
  let i = source.startsWith("#!") ? source.indexOf("\n") : 0;
  if (i < 0) return out;
  // Whether the last significant token ends an expression: then `/` divides and `<` compares.
  let afterValue = false;

  const lineComment = () => {
    const end = source.indexOf("\n", i);
    const stop = end < 0 ? n : end;
    out.push([lineAt(i), source.slice(i + 2, stop)]);
    i = stop;
  };

  const blockComment = () => {
    const first = lineAt(i);
    const end = source.indexOf("*/", i + 2);
    const stop = end < 0 ? n : end;
    source
      .slice(i + 2, stop)
      .split("\n")
      .forEach((text, k) => out.push([first + k, text]));
    i = end < 0 ? n : end + 2;
  };

  const quoted = (quote: string) => {
    i++;
    while (i < n) {
      const c = source[i];
      if (c === "\\") i += 2;
      else if (c === quote) {
        i++;
        return;
      } else if (c === "\n") return;
      else i++;
    }
  };

  const regex = () => {
    i++;
    let inClass = false;
    while (i < n) {
      const c = source[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "\n") return;
      if (inClass) {
        if (c === "]") inClass = false;
      } else if (c === "[") inClass = true;
      else if (c === "/") {
        i++;
        while (i < n && /[a-z]/i.test(source[i])) i++;
        return;
      }
      i++;
    }
  };

  const template = () => {
    i++;
    while (i < n) {
      const c = source[i];
      if (c === "\\") i += 2;
      else if (c === "`") {
        i++;
        return;
      } else if (c === "$" && source[i + 1] === "{") {
        i += 2;
        afterValue = false;
        code(true);
      } else i++;
    }
  };

  const children = () => {
    while (i < n) {
      const c = source[i];
      if (c === "{") {
        i++;
        afterValue = false;
        code(true);
      } else if (c === "<" && source[i + 1] === "/") {
        const end = source.indexOf(">", i);
        i = end < 0 ? n : end + 1;
        return;
      } else if (c === "<") element();
      else i++;
    }
  };

  const element = () => {
    i++;
    if (source[i] === ">") {
      i++;
      children();
      return;
    }
    while (i < n && /[\w.:$-]/.test(source[i])) i++;
    while (i < n) {
      const c = source[i];
      const d = source[i + 1];
      if (c === "/" && d === ">") {
        i += 2;
        return;
      }
      if (c === ">") {
        i++;
        children();
        return;
      }
      if (c === "{") {
        i++;
        afterValue = false;
        code(true);
      } else if (c === '"' || c === "'") {
        const end = source.indexOf(c, i + 1);
        i = end < 0 ? n : end + 1;
      } else if (c === "/" && d === "/") lineComment();
      else if (c === "/" && d === "*") blockComment();
      else i++;
    }
  };

  const code = (untilBrace: boolean) => {
    while (i < n) {
      const c = source[i];
      const d = source[i + 1];
      if (c === "/" && d === "/") lineComment();
      else if (c === "/" && d === "*") blockComment();
      else if (c === '"' || c === "'") {
        quoted(c);
        afterValue = true;
      } else if (c === "`") {
        template();
        afterValue = true;
      } else if (c === "/") {
        if (afterValue) i++;
        else regex();
        afterValue = !afterValue;
      } else if (c === "<" && jsx && !afterValue && /[A-Za-z>]/.test(d ?? "")) {
        element();
        afterValue = true;
      } else if (c === "{") {
        i++;
        afterValue = false;
        code(true);
        afterValue = false;
      } else if (c === "}") {
        i++;
        afterValue = false;
        if (untilBrace) return;
      } else if (c === ")" || c === "]") {
        i++;
        afterValue = true;
      } else if (/[A-Za-z_$\u0080-￿]/.test(c)) {
        const start = i;
        while (i < n && /[\w$\u0080-￿]/.test(source[i])) i++;
        afterValue = !EXPRESSION_KEYWORDS.has(source.slice(start, i));
      } else if (/\d/.test(c)) {
        while (i < n && /[\w.]/.test(source[i])) i++;
        afterValue = true;
      } else if (/\s/.test(c)) i++;
      else {
        i++;
        afterValue = false;
      }
    }
  };

  code(false);
  return out;
}

/**
 * Every comment in the Rust `source` as its line number and the text after the comment opener,
 * one entry per source line a comment covers: `//`, `///` and `//!` lines and nested `/* *\/`
 * blocks. String, raw string and char literals are skipped, so a `//` inside one does not open a
 * comment; a `'` that starts a lifetime is not a char literal.
 */
function rustComments(source: string): CommentLine[] {
  const chars = Array.from(source);
  const at = (i: number): string | undefined => chars[i];
  const out: CommentLine[] = [];
  let line = 1;
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "/" && at(i + 1) === "/") {
      let end = i;
      while (end < chars.length && chars[end] !== "\n") end++;
      out.push([line, chars.slice(i + 2, end).join("")]);
      i = end;
    } else if (c === "/" && at(i + 1) === "*") {
      let depth = 1;
      let text = "";
      i += 2;
      while (depth > 0 && i < chars.length) {
        const [x, y] = [at(i), at(i + 1)];
        if (x === "/" && y === "*") {
          depth++;
          text += "/*";
          i += 2;
        } else if (x === "*" && y === "/") {
          depth--;
          i += 2;
        } else if (x === "\n") {
          out.push([line, text]);
          text = "";
          line++;
          i++;
        } else {
          text += x;
          i++;
        }
      }
      out.push([line, text]);
    } else if (c === "r" && startsRawString(chars, i)) {
      let hashes = 0;
      while (at(i + 1 + hashes) === "#") hashes++;
      let j = i + 2 + hashes;
      while (j < chars.length) {
        const x = chars[j];
        if (x === "\n") line++;
        let closes = x === '"';
        for (let k = 1; closes && k <= hashes; k++) closes = at(j + k) === "#";
        if (closes) {
          j += 1 + hashes;
          break;
        }
        j++;
      }
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < chars.length) {
        const x = chars[j];
        if (x === "\\") {
          if (at(j + 1) === "\n") line++;
          j += 2;
        } else if (x === '"') break;
        else {
          if (x === "\n") line++;
          j++;
        }
      }
      i = j + 1;
    } else if (c === "'") {
      if (at(i + 1) === "\\") {
        let j = i + 3;
        while (j < chars.length && chars[j] !== "'") j++;
        i = j + 1;
      } else if (at(i + 2) === "'") i += 3;
      else i++;
    } else i++;
  }
  return out;
}

/**
 * Whether the `r` at `i` opens a raw string literal (`r"`, `r#"`, `br"`, `cr#"` and so on)
 * rather than ending an identifier or starting a raw identifier.
 */
function startsRawString(chars: string[], i: number): boolean {
  const isIdent = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
  const before = chars[i - 1];
  const prefixOk =
    before === undefined || before === "b" || before === "c"
      ? before === undefined || !isIdent(chars[i - 2])
      : !isIdent(before);
  let j = i + 1;
  while (chars[j] === "#") j++;
  return prefixOk && chars[j] === '"';
}

/** Whether `path`, relative to the repository root, is generated or vendored output. */
function isExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some((excluded) => path === excluded || path.startsWith(`${excluded}/`));
}

/**
 * Every file under `root` (a directory or a single file) whose extension maps to a language
 * in `languages`, as its repository-relative path and language.
 */
function collect(
  repo: string,
  root: string,
  languages: (extension: string) => Language | undefined,
  out: Map<string, Language>,
): void {
  const full = join(repo, root);
  let isDir: boolean;
  try {
    isDir = statSync(full).isDirectory();
  } catch {
    return;
  }
  const visit = (path: string, dir: boolean) => {
    const shown = relative(repo, path).split(sep).join("/");
    if (isExcluded(shown)) return;
    if (dir) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
        visit(join(path, entry.name), entry.isDirectory());
      }
      return;
    }
    const dot = shown.lastIndexOf(".");
    const language = dot < 0 ? undefined : languages(shown.slice(dot));
    if (language) out.set(shown, language);
  };
  visit(full, isDir);
}

/** The token class of the first offence in `source`, if any. */
function firstOffence(source: string, language: Language): string | undefined {
  return offences(source, language)[0]?.token;
}

describe("comments", () => {
  it("carry no history, references, finding ids or personas", () => {
    const repo = process.cwd();
    const files = new Map<string, Language>();
    for (const root of SCRIPT_ROOTS) collect(repo, root, (ext) => SCRIPT_EXTENSIONS[ext], files);
    for (const root of RUST_ROOTS) {
      collect(repo, root, (ext) => (ext === ".rs" ? "rust" : undefined), files);
    }
    expect(files.size).toBeGreaterThan(100);

    const report: string[] = [];
    for (const [path, language] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      const text = readFileSync(join(repo, path), "utf8");
      const lines = text.split("\n");
      for (const offence of offences(text, language)) {
        const sourceLine = (lines[offence.line - 1] ?? "").trim();
        report.push(
          `${path}:${offence.line}: ${offence.token} \`${offence.found}\` in: ${sourceLine}`,
        );
      }
    }

    expect(
      report,
      "comments say what the code is and does: no history, no pointers to docs, plans, " +
        "tickets or pull requests, no finding ids, no task markers, no first-person plural " +
        "voice, no section signs and no persona names. Rewrite each comment below:\n" +
        report.join("\n"),
    ).toEqual([]);
  });

  it("are recognised for each kind of banned token", () => {
    const banned: [string, Language, string][] = [
      ["// Phase 1 ships this", "ts", "Phase N"],
      ["/** see Track 4.1 */", "ts", "Track N"],
      ["// Stage 2 adds the panel", "ts", "Stage N"],
      ["// P4-A5 builtins", "ts", "plan item id"],
      ["// part of the master plan", "ts", "master plan"],
      ["    // per §3.5", "ts", "section sign"],
      ["// Widow's finding", "ts", "persona name"],
      ["// closes N1", "ts", "finding id"],
      ["/** the F2 check */", "ts", "finding id"],
      ["// H1 regression", "tsx", "finding id"],
      ["// the S-H3 leak", "ts", "finding id"],
      ["// see A-H2", "ts", "finding id"],
      ["// We drive 31 requests", "ts", "design-note voice"],
      ["/** the cache is ours */", "ts", "design-note voice"],
      ["// let us check", "ts", "design-note voice"],
      ["call(); // but we'll execute with args_b", "ts", "design-note voice"],
      ["/*\n * as we found\n */", "ts", "design-note voice"],
      ["// the legacy path", "ts", "legacy"],
      ["// kept for a follow-up", "ts", "follow-up"],
      ["// left as a followup", "ts", "follow-up"],
      ["// previously returned 404", "ts", "previously"],
      ["// this used to panic", "ts", "used to"],
      ["// the default used to be 30", "ts", "used to"],
      ["// TODO(kuba): drop this", "ts", "task marker"],
      ["// FIXME", "ts", "task marker"],
      ["// added in PR 10", "ts", "pull request number"],
      ["// see PR #12", "ts", "pull request number"],
      ["// fixes #55", "ts", "issue reference"],
      ["// (see #208)", "ts", "issue reference"],
      ["// the FL2 exception", "ts", "finding label"],
      ["// see docs/pagination.md", "ts", "docs pointer"],
      ["/** See `docs/specs/key-identity-v1.md` */", "ts", "docs pointer"],
      ["// per spec section 4", "ts", "spec section"],
      ["// the specification section on keys", "ts", "spec section"],
      ['const url = "https://example.com"; // we fetch it', "ts", "design-note voice"],
      ["const re = /a\\/b/g; // TODO", "ts", "task marker"],
      ["const re = /[/]/; // TODO", "ts", "task marker"],
      ["const t = `a\n${b}\nc`; // previously", "ts", "previously"],
      ["const x = a / b; // TODO", "ts", "task marker"],
      ["return <div>{/* we keep it */}</div>;", "tsx", "design-note voice"],
      ["<A\n  // we pass it\n  b={1}\n/>", "tsx", "design-note voice"],
      ["// Phase 1 ships this", "rust", "Phase N"],
      ["/// see Track 4.1", "rust", "Track N"],
      ["//! P4-A5 builtins", "rust", "plan item id"],
      ["/// the n1 check, N1", "rust", "finding id"],
      ["/* our reasoning */", "rust", "design-note voice"],
      ["/* outer /* inner */ we */", "rust", "design-note voice"],
      ["// fixes #55", "rust", "issue reference"],
      ["/// See `docs/specs/key-identity-v1.md`", "rust", "docs pointer"],
    ];
    for (const [source, language, token] of banned) {
      expect(firstOffence(source, language), `in ${JSON.stringify(source)}`).toBe(token);
    }

    const allowed: [string, Language][] = [
      ["// The phase of the incident", "ts"],
      ['const phase = "Phase 1";', "ts"],
      ["// Track the latest cursor", "ts"],
      ["// The multi-stage build", "ts"],
      ["// Vectors from key-identity-v1 appendix B.", "ts"],
      ["// The verified content of appendix A.4, which names the A.3 attachment.", "ts"],
      ["/** Used to build the invite link. */", "ts"],
      ["/** Returns a scope whose handle can be used to construct repositories. */", "ts"],
      ["/** The en-US locale. */", "ts"],
      ["/** Rejects `#5`, `PR 3` and `N1` inside a code span. */", "ts"],
      ["/** PKCS#8 with the seed in the last 32 bytes. */", "ts"],
      ["// Half width, the `w-1/2` class, or w-1/2 in prose.", "tsx"],
      ["// The accent colour #1e1e2e, or #fff on the panel.", "tsx"],
      ["// The F12 key, the h1 heading and the 4.1 release.", "ts"],
      ["// Percent-encodes ü as %C3%BC; the colour #C0C0C0.", "ts"],
      ["/// Percent-encodes ü as %C3%BC.", "rust"],
      ["/** The previous value, if any. */", "ts"],
      ["/** Devices that no longer belong to the group. */", "ts"],
      ['const url = "https://example.com/we"; // a plain URL', "ts"],
      ['const s = "// we do this";', "ts"],
      ["const s = '// we do this';", "ts"],
      ['const s = "escaped \\" // we";', "ts"],
      ["const re = /\\/\\/ we/; // a regex", "ts"],
      ["const re = /[\"'`]/; // quotes", "ts"],
      ["const ok = x.match(/https?:\\/\\/we/);", "ts"],
      ["const t = `line one\n// we are text\n${a /* inner */}\nend`; // done", "ts"],
      ["const t = `${`// we nested`}`;", "ts"],
      ["const half = total / 2; const r = /we/.test(s) / 1;", "ts"],
      ['return <a href="https://example.com/we">// we are text</a>;', "tsx"],
      ["return <p>Don't use our key</p>; // rendered", "tsx"],
      ['return <div className="w-1/2">{/* the left half */}</div>;', "tsx"],
      ["const n = useState<string>(''); // the name", "tsx"],
      ["#!/usr/bin/env node\n// The release script.", "ts"],
      ["/// The phase of the incident", "rust"],
      ['let phase = "Phase 1";', "rust"],
      ["/// Used to build the `/join/{token}` invite link.", "rust"],
      ["/// The en-US locale.", "rust"],
      ["/// PKCS#8 with the seed in the last 32 bytes.", "rust"],
      ["// Formats with {:#04x}.", "rust"],
      ["#[derive(Debug)]", "rust"],
      ["#![allow(dead_code)]", "rust"],
      ["// Vectors from key-identity-v1 appendix B, section A.3.", "rust"],
      ['let url = "https://example.com/we"; // a plain URL', "rust"],
      ['let s = "// we do this";', "rust"],
      ['let s = "escaped \\" // we";', "rust"],
      ['let s = r#"// we "quoted" here"#;', "rust"],
      ["let c = '\"'; let d = '\\''; // fine", "rust"],
      ["fn f<'a>(x: &'a str) -> &'a str { x } // borrows", "rust"],
      ["/// ```\n/// let us = 1;\n/// ```", "rust"],
      ["/**\n * ```ts\n * const us = 1;\n * ```\n */", "ts"],
    ];
    for (const [source, language] of allowed) {
      expect(firstOffence(source, language), `in ${JSON.stringify(source)}`).toBeUndefined();
    }

    expect(
      offences("const s = `a\nb`;\n// previously", "ts")[0]?.line,
      "a template literal spanning lines still counts its lines",
    ).toBe(3);
    expect(
      offences('let s = "a \\\n b";\n// previously', "rust")[0]?.line,
      "a string continued with a backslash still counts its line",
    ).toBe(3);
    expect(offences("fn f() {}\n\n    x(); // we said TODO", "rust")).toEqual([
      { line: 3, token: "design-note voice", found: "we" },
      { line: 3, token: "task marker", found: "TODO" },
    ]);
  });
});
