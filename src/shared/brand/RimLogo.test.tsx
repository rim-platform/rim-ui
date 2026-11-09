import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RimLockup, RimMark, RimSplash } from "./RimLogo";

const BOLT = "M115 8 L84 44 H100 L91 72 L122 36 H106 Z";

describe("RIM brand graphics", () => {
  it("draws the mark in the current text colour with a signal node", () => {
    const { container } = render(<RimMark className="h-4" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox", "0 0 100 100");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveClass("h-4");
    expect(svg?.querySelectorAll("rect")).toHaveLength(1);
    expect(svg?.querySelectorAll("path")).toHaveLength(2);
    expect(svg?.querySelectorAll("circle")).toHaveLength(1);
    expect(svg?.querySelector("circle")).toHaveClass("fill-rim-signal");
  });

  it("draws the lockup with a signal node and a signal bolt", () => {
    const { container } = render(<RimLockup className="h-4" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox", "0 0 214 80");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveClass("h-4");
    expect(svg?.querySelectorAll("rect")).toHaveLength(1);
    expect(svg?.querySelectorAll("path")).toHaveLength(4);
    expect(svg?.querySelectorAll("circle")).toHaveLength(1);
    const signal = [...(svg?.querySelectorAll(".fill-rim-signal") ?? [])];
    expect(signal).toHaveLength(2);
    expect(signal.map((el) => el.tagName).sort()).toEqual(["circle", "path"]);
    expect(signal.find((el) => el.tagName === "path")).toHaveAttribute("d", BOLT);
  });

  it("names a labelled graphic as an image and hides an unlabelled one", () => {
    const { container } = render(
      <>
        <RimLockup label="RIM" />
        <RimMark />
      </>,
    );

    expect(screen.getByRole("img", { name: "RIM" })).toHaveAttribute("viewBox", "0 0 214 80");
    expect(container.querySelector('svg[viewBox="0 0 100 100"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("layers a pulsing glow behind the splash's bolt with filters unique to each instance", () => {
    const { container } = render(
      <>
        <RimSplash />
        <RimSplash />
      </>,
    );
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs).toHaveLength(2);

    const idSets = svgs.map((svg) => {
      const ids = [...svg.querySelectorAll("filter")].map((f) => f.id);
      expect(ids).toHaveLength(3);

      const referenced = [...svg.querySelectorAll("path[filter]")].map((p) =>
        p.getAttribute("filter"),
      );
      expect(referenced).toHaveLength(3);
      for (const ref of referenced) {
        expect(ids.map((id) => `url(#${id})`)).toContain(ref);
      }

      for (const cls of ["rim-glow-wide", "rim-glow-halo", "rim-glow-core", "rim-glow-bolt"]) {
        expect(svg.querySelectorAll(`.${cls}`)).toHaveLength(1);
      }
      return ids;
    });

    expect(idSets[0].filter((id) => idSets[1].includes(id))).toEqual([]);
  });
});
