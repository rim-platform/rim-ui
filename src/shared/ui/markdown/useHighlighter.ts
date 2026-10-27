import { useEffect, useState } from "react";

import { importWithRetry } from "../../lazy/importWithRetry";
import { logger } from "../../../core/logger";
import type { Highlighter } from "./renderMarkdown";

/** A fenced code block with an info string (a language hint). */
const FENCE_WITH_LANGUAGE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*[^\s`~]/m;

let loaded: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

/** Loads the highlighter chunk once; later calls share the same promise. */
export function loadHighlighter(): Promise<Highlighter> {
  loading ??= importWithRetry(() => import("./codeHighlight"))
    .then((module) => {
      loaded = module.highlightCode;
      return loaded;
    })
    .catch((err: unknown) => {
      loading = null;
      throw err;
    });
  return loading;
}

/** True when `content` has a fenced code block with a language hint. */
export function wantsHighlighter(content: string): boolean {
  return FENCE_WITH_LANGUAGE.test(content);
}

/**
 * The code highlighter once loaded, or null. Content without a language-hinted code block
 * never loads it; content with one renders plain first and highlighted when the chunk arrives.
 */
export function useHighlighter(content: string): Highlighter | null {
  const wanted = wantsHighlighter(content);
  const [highlighter, setHighlighter] = useState<Highlighter | null>(() => loaded);

  useEffect(() => {
    if (!wanted || highlighter) return;
    let active = true;
    loadHighlighter()
      .then((h) => {
        if (active) setHighlighter(() => h);
      })
      .catch((err: unknown) => {
        logger.warn("[RIM:markdown] the code highlighter could not be loaded:", err);
      });
    return () => {
      active = false;
    };
  }, [wanted, highlighter]);

  return wanted ? highlighter : null;
}
