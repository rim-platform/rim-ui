import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { RimLockup, RimMark, RimSplash } from "./RimLogo";

describe("RIM brand graphics", () => {
  it.each([
    ["mark", RimMark, "0 0 100 100", 2],
    ["lockup", RimLockup, "0 0 231 100", 6],
  ] as const)("draws the %s in the current text colour", (_name, Graphic, viewBox, pieces) => {
    const { container } = render(<Graphic className="h-4" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox", viewBox);
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveClass("h-4");
    expect(svg?.querySelectorAll("path")).toHaveLength(pieces);
  });

  it("names a labelled graphic as an image and hides an unlabelled one", () => {
    const { container } = render(
      <>
        <RimLockup label="RIM" />
        <RimMark />
      </>,
    );

    expect(screen.getByRole("img", { name: "RIM" })).toHaveAttribute("viewBox", "0 0 231 100");
    expect(container.querySelector('svg[viewBox="0 0 100 100"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("staggers the splash's three letters and fills only the M circle with the signal colour", () => {
    const { container } = render(<RimSplash />);
    const balls = [...container.querySelectorAll<SVGGElement>(".rim-splash-ball")];

    expect(balls.map((ball) => ball.style.animationDelay)).toEqual(["0s", "0.15s", "0.3s"]);
    expect(balls.map((ball) => ball.querySelector("circle")?.getAttribute("class"))).toEqual([
      "fill-current",
      "fill-current",
      "fill-rim-signal",
    ]);
    expect(balls.map((ball) => ball.querySelectorAll("path").length)).toEqual([2, 2, 2]);
  });
});
