import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runtime = vi.hoisted(() => ({ platform: "web" as "web" | "desktop" }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: runtime.platform }),
}));

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: vi.fn(),
}));

import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { BUILT_IN_PROFILES, DEFAULT_BINDINGS } from "../profiles/builtInProfiles";
import {
  PROFILE_FORMAT,
  mergeOverDefaults,
  parseKeybindProfile,
  serializeKeybindProfile,
  type KeybindProfile,
} from "../profiles/keybindProfile";
import { useCommandStore } from "../state/useCommandStore";
import { useKeybindProfileStore } from "../state/useKeybindProfileStore";
import { KeyboardSettings } from "./KeyboardSettings";

const custom: KeybindProfile = {
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

/** The box that asks how to import a profile file. */
async function importBox(): Promise<HTMLElement> {
  return screen.findByRole("group", { name: "Import profile" });
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
      const box = await importBox();
      expect(box).toHaveTextContent('Import "Team keys"?');
      expect(box).toHaveTextContent("the profile's 1 binding take the keys they name");
      expect(within(box).getByRole("button", { name: "Merge" })).toHaveFocus();
      expect(useKeybindProfileStore.getState().profile).toEqual(BUILT_IN_PROFILES.minimal);

      await user.click(within(box).getByRole("button", { name: "Merge" }));

      expect(screen.getByRole("status")).toHaveTextContent(
        'Imported "Team keys" over the defaults: 1 binding, Vim mode on.',
      );
      expect(screen.queryByRole("group", { name: "Import profile" })).not.toBeInTheDocument();
      expect(useKeybindProfileStore.getState()).toMatchObject({
        profile: custom,
        replacesDefaults: false,
      });
      expect(screen.getByText("Active: Team keys")).toBeInTheDocument();
      expect(
        screen.getByText(
          "An imported profile over the default shortcuts. Choosing one above replaces it.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Minimal/ })).not.toBeChecked();
    });

    it("Replace all imports the profile in place of the defaults", async () => {
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      await user.upload(
        screen.getByTestId("keybind-profile-file"),
        jsonFile(JSON.stringify(custom)),
      );
      await user.click(within(await importBox()).getByRole("button", { name: "Replace all" }));

      expect(screen.getByRole("status")).toHaveTextContent(
        'Imported "Team keys" in place of the defaults: 1 binding, Vim mode on.',
      );
      expect(useKeybindProfileStore.getState()).toMatchObject({
        profile: custom,
        replacesDefaults: true,
      });
      expect(
        screen.getByText(
          "An imported profile in place of the default shortcuts. Choosing one above replaces it.",
        ),
      ).toBeInTheDocument();
    });

    it("Cancel leaves the active profile as it was", async () => {
      const user = userEvent.setup();
      render(<KeyboardSettings />);
      const input = screen.getByTestId("keybind-profile-file");
      await user.upload(input, jsonFile(JSON.stringify(custom)));
      await user.click(within(await importBox()).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("group", { name: "Import profile" })).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(useKeybindProfileStore.getState().profile).toEqual(BUILT_IN_PROFILES.minimal);

      // Escape inside the box cancels too.
      await user.upload(input, jsonFile(JSON.stringify(custom)));
      await importBox();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("group", { name: "Import profile" })).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(useKeybindProfileStore.getState().profile).toEqual(BUILT_IN_PROFILES.minimal);
      // Focus goes back to the button that started the import.
      expect(screen.getByRole("button", { name: "Import profile" })).toHaveFocus();
    });

    it("exports the merged bindings", async () => {
      const createObjectURL = vi.fn((blob: Blob) => {
        void blob;
        return "blob:profile";
      });
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      useKeybindProfileStore.getState().setProfile(custom);
      const user = userEvent.setup();
      render(<KeyboardSettings />);

      await user.click(screen.getByRole("button", { name: "Export profile" }));

      const saved = parseKeybindProfile(await createObjectURL.mock.calls[0][0].text());
      if (!saved.ok) throw new Error(saved.errors.join("\n"));
      expect(saved.profile).toEqual(mergeOverDefaults(DEFAULT_BINDINGS, custom));
      expect(saved.profile.bindings).toEqual([...DEFAULT_BINDINGS, ...custom.bindings]);
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
      await user.click(within(await importBox()).getByRole("button", { name: "Merge" }));
      await waitFor(() => expect(useKeybindProfileStore.getState().profile).toEqual(custom));
      expect(screen.getByRole("status")).toHaveTextContent(
        'Imported "Team keys" over the defaults: 1 binding, Vim mode on.',
      );
    });
  });
});
