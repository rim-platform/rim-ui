import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LensBanner } from "./LensBanner";

describe("LensBanner", () => {
  it("shows the lens name and pluralised condition count", () => {
    const { rerender } = render(
      <LensBanner lensName="Links" conditionCount={1} onClear={vi.fn()} />,
    );
    expect(screen.getByText("Links")).toBeInTheDocument();
    expect(screen.getByText("1 condition")).toBeInTheDocument();

    rerender(<LensBanner lensName="Links" conditionCount={3} onClear={vi.fn()} />);
    expect(screen.getByText("3 conditions")).toBeInTheDocument();
  });

  it("clears the lens", () => {
    const onClear = vi.fn();
    render(<LensBanner lensName="Links" conditionCount={1} onClear={onClear} />);
    fireEvent.click(screen.getByLabelText("Clear lens"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
