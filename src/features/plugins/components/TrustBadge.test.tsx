import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustBadge } from "./TrustBadge";
import type { TrustLevel } from "../types";

describe("TrustBadge", () => {
  const levels: TrustLevel[] = ["official", "verified", "community", "unverified"];

  it.each(levels)("renders the correct label for '%s' trust level", (level) => {
    render(<TrustBadge level={level} />);

    const expectedLabels: Record<TrustLevel, string> = {
      official: "Official",
      verified: "Verified",
      community: "Community",
      unverified: "Unverified",
    };

    expect(screen.getByText(expectedLabels[level])).toBeInTheDocument();
  });

  it("renders as a span element", () => {
    const { container } = render(<TrustBadge level="official" />);
    const span = container.querySelector("span");
    expect(span).toBeInTheDocument();
  });

  it("applies different styles for official vs unverified", () => {
    const { rerender, container } = render(<TrustBadge level="official" />);
    const officialSpan = container.querySelector("span");
    const officialClasses = officialSpan?.className ?? "";

    rerender(<TrustBadge level="unverified" />);
    const unverifiedSpan = container.querySelector("span");
    const unverifiedClasses = unverifiedSpan?.className ?? "";

    expect(officialClasses).not.toBe(unverifiedClasses);
  });

  it("applies different styles for verified vs community", () => {
    const { rerender, container } = render(<TrustBadge level="verified" />);
    const verifiedClasses = container.querySelector("span")?.className ?? "";

    rerender(<TrustBadge level="community" />);
    const communityClasses = container.querySelector("span")?.className ?? "";

    expect(verifiedClasses).not.toBe(communityClasses);
  });
});
