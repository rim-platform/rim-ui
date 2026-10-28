import * as microfuzz from "@nozbe/microfuzz";
import type { HighlightRanges } from "@nozbe/microfuzz";

import type { CommandDefinition } from "../types";

type CreateFuzzySearch = typeof microfuzz.default;

/**
 * microfuzz's `createFuzzySearch` from the package's module namespace. The package is CommonJS:
 * the test runner gives its default export as the function itself, the production bundle as
 * the module object that holds the function under `default`.
 *
 * @param mod - the namespace `import * as` gives for `@nozbe/microfuzz`
 * @returns the `createFuzzySearch` function
 */
export function fuzzySearchFactory(mod: { default: unknown }): CreateFuzzySearch {
  const inner = mod.default as { default?: unknown } | undefined;
  const fn = typeof mod.default === "function" ? mod.default : inner?.default;
  if (typeof fn !== "function") throw new Error("@nozbe/microfuzz exports no createFuzzySearch");
  return fn as CreateFuzzySearch;
}

const createFuzzySearch = fuzzySearchFactory(microfuzz);

/** The collation the palette sorts titles and categories by: the app's titles are English. */
const PALETTE_LOCALE = "en";

/** The score microfuzz gives a query found inside a word rather than at its start. */
const MID_WORD_CONTAINS_SCORE = 2;

/**
 * `ranges` sorted by start with overlapping or touching ranges merged, as `<Highlight>` needs.
 * microfuzz can return the same span twice when a query word matches the field in two ways.
 */
export function normalizeRanges(
  ranges: HighlightRanges | null | undefined,
): HighlightRanges | null {
  if (!ranges) return null;
  const merged: [number, number][] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** One command the palette lists for a search, with the letters to highlight. */
export interface PaletteMatch<T> {
  item: T;
  /** 0 when the title matches, 1 when only the description or category does. */
  tier: 0 | 1;
  /** How well the matching field matches; lower is better. */
  score: number;
  titleRanges: HighlightRanges | null;
  descriptionRanges: HighlightRanges | null;
}

type Searchable = Pick<CommandDefinition, "title" | "description" | "category">;

function compareMatches<T extends Searchable>(a: PaletteMatch<T>, b: PaletteMatch<T>): number {
  return (
    a.tier - b.tier ||
    a.score - b.score ||
    a.item.category.localeCompare(b.item.category, PALETTE_LOCALE) ||
    a.item.title.localeCompare(b.item.title, PALETTE_LOCALE)
  );
}

/**
 * A search over the palette's commands. A title match ranks above a description or category
 * match; in a description or category only a match that starts at a word counts, since nearly
 * any few letters turn up somewhere in a sentence. Commands stay grouped by category, the groups
 * in the order of their best match. An empty query lists everything grouped alphabetically by
 * category, alphabetically by title inside a group.
 */
export function createPaletteSearch<T extends Searchable>(
  list: T[],
): (query: string) => PaletteMatch<T>[] {
  const byTitle = createFuzzySearch(list, {
    getText: (cmd: T) => [cmd.title],
    strategy: "aggressive",
  });
  const byDescription = createFuzzySearch(list, {
    getText: (cmd: T) => [cmd.description, cmd.category],
    strategy: "off",
  });

  return (query) => {
    if (!query.trim()) {
      return [...list]
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category, PALETTE_LOCALE) ||
            a.title.localeCompare(b.title, PALETTE_LOCALE),
        )
        .map((item) => ({
          item,
          tier: 0,
          score: 0,
          titleRanges: null,
          descriptionRanges: null,
        }));
    }

    const descriptionHits = new Map(byDescription(query).map((hit) => [hit.item, hit]));
    const ranked: PaletteMatch<T>[] = byTitle(query).map((hit) => ({
      item: hit.item,
      tier: 0,
      score: hit.score,
      titleRanges: normalizeRanges(hit.matches[0]),
      descriptionRanges: normalizeRanges(descriptionHits.get(hit.item)?.matches[0]),
    }));
    const titleHits = new Set(ranked.map((match) => match.item));
    for (const hit of descriptionHits.values()) {
      if (titleHits.has(hit.item) || hit.score === MID_WORD_CONTAINS_SCORE) continue;
      ranked.push({
        item: hit.item,
        tier: 1,
        score: hit.score,
        titleRanges: null,
        descriptionRanges: normalizeRanges(hit.matches[0]),
      });
    }
    ranked.sort(compareMatches);

    const groupOrder = new Map<string, number>();
    ranked.forEach((match, index) => {
      if (!groupOrder.has(match.item.category)) groupOrder.set(match.item.category, index);
    });
    return ranked.sort(
      (a, b) => (groupOrder.get(a.item.category) ?? 0) - (groupOrder.get(b.item.category) ?? 0),
    );
  };
}
