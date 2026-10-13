import { cn } from "../../../shared/ui/cn";
import { SEARCH_SUGGESTIONS_ID, type Suggestion } from "./searchSuggestions";

interface SearchSuggestionsPopoverProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  onPick: (suggestion: Suggestion) => void;
  onHover: (index: number) => void;
}

/** The operator value popover under the search input; rows insert their value when clicked. */
export function SearchSuggestionsPopover({
  suggestions,
  selectedIndex,
  onPick,
  onHover,
}: SearchSuggestionsPopoverProps) {
  return (
    <ul
      id={SEARCH_SUGGESTIONS_ID}
      role="listbox"
      aria-label="Operator suggestions"
      className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-rim-line bg-rim-panel p-1 shadow-xl"
    >
      {suggestions.map((suggestion, index) => (
        <li
          key={suggestion.id}
          id={`${SEARCH_SUGGESTIONS_ID}-${index}`}
          role="option"
          aria-selected={index === selectedIndex}
          className={cn(
            "flex cursor-pointer items-baseline justify-between gap-2 rounded-md px-3 py-1.5 text-xs",
            index === selectedIndex ? "bg-rim-accent/10 text-rim-text" : "text-rim-text-muted",
          )}
          // Keeps focus in the search input so the caret survives the click.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(suggestion)}
        >
          <span className="truncate">{suggestion.label}</span>
          {suggestion.detail && (
            <span className="shrink-0 text-[10px] text-rim-text-faint">{suggestion.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
