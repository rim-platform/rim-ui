import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../shared/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ShowOnceDialog } from "./ShowOnceDialog";

describe("ShowOnceDialog", () => {
  it("holds the whole value in a labelled read-only text area", () => {
    const value = `https://rim.example/api/hooks/${"x".repeat(300)}`;
    render(<ShowOnceDialog title="Webhook URL" label="URL" value={value} onClose={() => {}} />);
    const field = screen.getByLabelText("URL");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAttribute("rows", "3");
    expect(field).toHaveValue(value);
    expect(field).toHaveClass("break-all", "resize-none");
  });
});
