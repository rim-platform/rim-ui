import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageDisplaySettings } from "./MessageDisplaySettings";
import { useClockFormatStore } from "../../../shared/state/useClockFormatStore";
import { useMessageDisplaySettingsStore } from "../state/useMessageDisplaySettingsStore";

const STORAGE_KEY = "rim:message-display-settings";

afterEach(() => {
  useMessageDisplaySettingsStore.setState({ showInlineMedia: true });
  useClockFormatStore.setState({ clockFormat: "auto" });
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("rim:clock-format");
});

describe("MessageDisplaySettings", () => {
  it("shows inline media by default", () => {
    render(<MessageDisplaySettings />);
    expect(screen.getByRole("switch", { name: "Show inline media" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("turns inline media off and keeps the choice on this device", async () => {
    const user = userEvent.setup();
    render(<MessageDisplaySettings />);
    const toggle = screen.getByRole("switch", { name: "Show inline media" });
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(useMessageDisplaySettingsStore.getState().showInlineMedia).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      showInlineMedia: false,
    });
  });

  it("sets the clock to 24-hour", async () => {
    const user = userEvent.setup();
    render(<MessageDisplaySettings />);
    const select = screen.getByRole("combobox", { name: "Clock" });
    expect(select).toHaveValue("auto");
    await user.selectOptions(select, "24h");
    expect(useClockFormatStore.getState().clockFormat).toBe("24h");
  });
});
