import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runtime = vi.hoisted(() => ({ platform: "web" as "web" | "desktop" }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: runtime.platform }),
}));

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: vi.fn(),
}));

import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { BUILT_IN_PROFILES } from "../profiles/builtInProfiles";
import { PROFILE_FORMAT, serializeKeybindProfile } from "../profiles/keybindProfile";
import { useCommandStore } from "../state/useCommandStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { KeyboardSettings } from "./KeyboardSettings";

const custom = {
  format: PROFILE_FORMAT,
  version: 1,
  name: "Team keys",
  description: "",
  vimMode: true,
  bindings: [{ keystroke: "Ctrl+J", commandId: "workspace.open_search", context: "GLOBAL" }],
};

function jsonFile(content: string, name = "team.json"): File {
  return new File([content], name, { type: "application/json" });
}

describe("KeyboardSettings", () => {
  beforeEach(() => {
    runtime.platform = "web";
    useKeybindProfileStore.getState().selectBuiltIn("minimal");
    useCommandStore.setState({ isShortcutsPanelOpen: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(safeInvoke).mockReset();
  });

  it("starts on the minimal profile with Vim mode off", () => {
    render(<KeyboardSettings />);
    expect(screen.getByRole("radio", { name: /Minimal/ })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Vim mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("switches profiles with the keyboard and turns Vim mode on with the vim profile", async () => {
    const user = userEvent.setup();
    render(<KeyboardSettings />);
    screen.getByRole("radio", { name: /Minimal/ }).focus();
    await user.keyboard("{ArrowDown}");
    expect(useKeybindProfileStore.getState().profile).toEqual(BUILT_IN_PROFILES.vim);
    expect(screen.getByRole("switch", { name: "Vim mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggles Vim mode in the active profile", async () => {
    const user = userEvent.setup();
    render(<KeyboardSettings />);
    await user.click(screen.getByRole("switch", { name: "Vim mode" }));
    expect(useKeybindProfileStore.getState().profile.vimMode).toBe(true);
    // Minimal with Vim on is the vim profile.
    expect(screen.getByRole("radio", { name: /Vim/ })).toBeChecked();
  });

  it("opens the shortcuts panel", async () => {
    const user = userEvent.setup();
    render(<KeyboardSettings />);
    await user.click(screen.getByRole("button", { name: "Show shortcuts" }));
    expect(useCommandStore.getState().isShortcutsPanelOpen).toBe(true);
  });

  describe("on the web", () => {
    it("exports the profile as a download", async () => {
      const createObjectURL = vi.fn((blob: Blob) => {
        void blob;
        return "blob:profile";
      });
      const revokeObjectURL = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const user = userEvent.setup();
      render(<KeyboardSettings />);

      await user.click(screen.getByRole("button", { name: "Export profile" }));

      expect(click).toHaveBeenCalledTimes(1);
      const link = click.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toBe("rim-keybinds-minimal.json");
      const blob = createObjectURL.mock.calls[0][0];
      expect(await blob.text()).toBe(serializeKeybindProfile(BUILT_IN_PROFILES.minimal));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:profile");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saved the profile as rim-keybinds-minimal.json.",
      );
    });

    it("imports a profile file picked in the browser", async () => {
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.upload(
        screen.getByTestId("keybind-profile-file"),
        jsonFile(JSON.stringify(custom)),
      );
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          'Imported "Team keys": 1 binding, Vim mode on.',
        ),
      );
      expect(useKeybindProfileStore.getState().profile).toEqual(custom);
      expect(screen.getByText("Active: Team keys")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Minimal/ })).not.toBeChecked();
    });

    it("refuses an invalid file with clear errors and keeps the active profile", async () => {
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.upload(
        screen.getByTestId("keybind-profile-file"),
        jsonFile(
          JSON.stringify({ ...custom, bindings: [{ keystroke: "Hyper+K", commandId: "x.y" }] }),
          "broken.json",
        ),
      );
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("broken.json was not imported:");
      expect(alert).toHaveTextContent('bindings[0].keystroke "Hyper" is not a modifier');
      expect(useKeybindProfileStore.getState().profile).toEqual(BUILT_IN_PROFILES.minimal);
    });

    it("refuses a file that is not JSON", async () => {
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.upload(screen.getByTestId("keybind-profile-file"), jsonFile("hello"));
      expect(await screen.findByRole("alert")).toHaveTextContent("The file is not valid JSON");
    });

    it("opens the file picker from the Import button", async () => {
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      const input = screen.getByTestId("keybind-profile-file");
      const click = vi.spyOn(input, "click");
      await user.click(screen.getByRole("button", { name: "Import profile" }));
      expect(click).toHaveBeenCalled();
      expect(safeInvoke).not.toHaveBeenCalled();
    });
  });

  describe("on the desktop", () => {
    beforeEach(() => {
      runtime.platform = "desktop";
    });

    it("exports through the native save dialog", async () => {
      vi.mocked(safeInvoke).mockResolvedValue({ ok: true, value: "/home/me/keys.json" });
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.click(screen.getByRole("button", { name: "Export profile" }));
      expect(safeInvoke).toHaveBeenCalledWith("keybind_profile_save", {
        fileName: "rim-keybinds-minimal.json",
        contents: serializeKeybindProfile(BUILT_IN_PROFILES.minimal),
      });
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Saved the profile as /home/me/keys.json.",
      );
    });

    it("says nothing when the save dialog is cancelled, and shows a failure", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce({ ok: true, value: null });
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.click(screen.getByRole("button", { name: "Export profile" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      vi.mocked(safeInvoke).mockResolvedValueOnce({
        ok: false,
        error: { kind: "backend_error", code: "INTERNAL_ERROR", message: "disk is full" },
      });
      await user.click(screen.getByRole("button", { name: "Export profile" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("disk is full");
    });

    it("imports through the native open dialog", async () => {
      vi.mocked(safeInvoke).mockResolvedValue({ ok: true, value: JSON.stringify(custom) });
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.click(screen.getByRole("button", { name: "Import profile" }));
      expect(safeInvoke).toHaveBeenCalledWith("keybind_profile_open", {});
      await waitFor(() => expect(useKeybindProfileStore.getState().profile).toEqual(custom));
    });
  });
});
