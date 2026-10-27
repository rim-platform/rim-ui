import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../api/usePluginSettings", () => ({
  usePluginSettingsState: vi.fn(),
  usePluginSettingsSave: vi.fn(),
  usePluginSettingsReset: vi.fn(),
}));

import {
  usePluginSettingsReset,
  usePluginSettingsSave,
  usePluginSettingsState,
} from "../api/usePluginSettings";
import { PluginSettingsError } from "../pluginSettings";
import type { PluginInfo, PluginSetting, PluginSettingsFormState } from "../types";
import { PluginSettingsDialog, WEB_SECRET_NOTICE } from "./PluginSettingsDialog";

const SCHEMA: PluginSetting[] = [
  {
    key: "context",
    title: "Kubernetes context",
    description: "The kubectl context to use.",
    value_type: "string",
    is_secret: false,
    placeholder: "prod-eu",
  },
  {
    key: "kubeconfig",
    title: "Kubeconfig file",
    description: "",
    value_type: "path",
    is_secret: false,
    placeholder: "~/.kube/config",
  },
  {
    key: "refresh_seconds",
    title: "Refresh every (seconds)",
    description: "",
    value_type: "integer",
    is_secret: false,
    default: 30,
    min: 5,
    max: 3600,
  },
  {
    key: "watch",
    title: "Watch for changes",
    description: "",
    value_type: "boolean",
    is_secret: false,
  },
  {
    key: "output",
    title: "Output",
    description: "",
    value_type: "enum",
    is_secret: false,
    options: ["table", "json"],
    default: "table",
  },
  {
    key: "api_token",
    title: "API server token",
    description: "A token for the API server.",
    value_type: "string",
    is_secret: true,
  },
];

const PLUGIN: PluginInfo = {
  plugin_id: "dev.example.pods",
  manifest_id: "dev.example.pods",
  display_name: "Pods",
  version: "1.0.0",
  description: "Lists pods.",
  enabled: true,
  capabilities: [],
  approved_capabilities: [],
  approved_ai_commands: [],
  ai_callable_commands: [],
  ai_consent_required: false,
  fingerprint_changed: false,
  settings_schema: SCHEMA,
};

function formState(overrides: Partial<PluginSettingsFormState> = {}): PluginSettingsFormState {
  return {
    values: { kubeconfig: "/home/k/.kube/config" },
    secrets: { api_token: true },
    secrets_available: true,
    secrets_error: null,
    ...overrides,
  };
}

type Options = { onSuccess?: () => void; onError?: (error: Error) => void };

let save: ReturnType<typeof vi.fn>;
let reset: ReturnType<typeof vi.fn>;

function mockHost(state: PluginSettingsFormState, saveImpl?: (vars: unknown, o: Options) => void) {
  vi.mocked(usePluginSettingsState).mockReturnValue({
    isPending: false,
    isError: false,
    data: state,
    dataUpdatedAt: 1,
  } as unknown as ReturnType<typeof usePluginSettingsState>);
  save = vi.fn(saveImpl ?? ((_vars: unknown, options: Options) => options.onSuccess?.()));
  vi.mocked(usePluginSettingsSave).mockReturnValue({
    mutate: save,
    isPending: false,
  } as unknown as ReturnType<typeof usePluginSettingsSave>);
  reset = vi.fn((_id: string, options: Options) => options.onSuccess?.());
  vi.mocked(usePluginSettingsReset).mockReturnValue({
    mutate: reset,
    isPending: false,
  } as unknown as ReturnType<typeof usePluginSettingsReset>);
}

function open(state = formState()) {
  mockHost(state);
  const onClose = vi.fn();
  render(<PluginSettingsDialog plugin={PLUGIN} onClose={onClose} />);
  return onClose;
}

const saveButton = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PluginSettingsDialog", () => {
  it("builds a field for each setting with its label, description and placeholder", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Pods settings" })).toBeInTheDocument();

    const context = screen.getByRole("textbox", { name: "Kubernetes context" });
    expect(context).toHaveValue("");
    expect(context).toHaveAttribute("placeholder", "prod-eu");
    expect(context).toHaveAccessibleDescription("The kubectl context to use.");

    expect(screen.getByRole("textbox", { name: "Kubeconfig file" })).toHaveValue(
      "/home/k/.kube/config",
    );
    const refresh = screen.getByRole("spinbutton", { name: "Refresh every (seconds)" });
    expect(refresh).toHaveValue(30);
    expect(refresh).toHaveAttribute("min", "5");
    expect(refresh).toHaveAttribute("max", "3600");
    expect(screen.getByRole("switch", { name: "Watch for changes" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("combobox", { name: "Output" })).toHaveValue("table");
    expect(screen.getByText("A token for the API server.")).toBeInTheDocument();
  });

  it("saves only the fields the user changed, an emptied one as null", () => {
    const onClose = open();
    fireEvent.change(screen.getByRole("textbox", { name: "Kubernetes context" }), {
      target: { value: "prod-eu" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Kubeconfig file" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Refresh every (seconds)" }), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Watch for changes" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Output" }), {
      target: { value: "json" },
    });
    fireEvent.click(saveButton());

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({
      pluginId: "dev.example.pods",
      changes: {
        context: "prod-eu",
        kubeconfig: null,
        refresh_seconds: 60,
        watch: true,
        output: "json",
      },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes without saving when nothing changed, and on Cancel", () => {
    const onClose = open();
    fireEvent.click(saveButton());
    expect(save).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows a field's error and saves nothing while a value does not fit", () => {
    const onClose = open();
    const refresh = screen.getByRole("spinbutton", { name: "Refresh every (seconds)" });
    fireEvent.change(refresh, { target: { value: "4" } });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent("Must be at least 5.");
    expect(refresh).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(refresh, { target: { value: "1.5" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent("Must be a whole number.");
    expect(save).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the host's refusal under the field it names", () => {
    mockHost(formState(), (_vars, options) =>
      options.onError?.(new PluginSettingsError("output must be one of: table, json", "output")),
    );
    const onClose = vi.fn();
    render(<PluginSettingsDialog plugin={PLUGIN} onClose={onClose} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Output" }), {
      target: { value: "json" },
    });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent("Must be one of: table, json.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never shows a saved secret, and replaces or clears it", () => {
    open();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    const input = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).not.toBeNull();
    expect(input).toHaveValue("");
    fireEvent.change(input!, { target: { value: "new-token" } });
    fireEvent.click(saveButton());
    expect(save.mock.calls[0][0]).toEqual({
      pluginId: "dev.example.pods",
      changes: { api_token: "new-token" },
    });
  });

  it("clears a secret, and Undo and Keep current leave it as it is", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep current" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Cleared when you save.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(saveButton());
    expect(save.mock.calls[0][0]).toEqual({
      pluginId: "dev.example.pods",
      changes: { api_token: null },
    });
  });

  it("offers an empty masked field for a secret not set yet", () => {
    open(formState({ secrets: { api_token: false } }));
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();
    const input = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).toHaveValue("");
    fireEvent.click(saveButton());
    expect(save).not.toHaveBeenCalled();
  });

  it("says a secret setting needs the desktop app in the web app", () => {
    open(formState({ secrets: { api_token: false }, secrets_available: false }));
    expect(screen.getByText(WEB_SECRET_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("offers only Close in the web app when every setting is secret", () => {
    const secretOnly: PluginInfo = {
      ...PLUGIN,
      settings_schema: SCHEMA.filter((setting) => setting.key === "api_token"),
    };
    mockHost(formState({ values: {}, secrets: { api_token: false }, secrets_available: false }));
    const onClose = vi.fn();
    render(<PluginSettingsDialog plugin={secretOnly} onClose={onClose} />);

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).toBeNull();
    const footerClose = screen
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.textContent === "Close");
    fireEvent.click(footerClose!);
    expect(onClose).toHaveBeenCalled();
  });

  it("says why secret settings cannot be read when the vault does not open", () => {
    open(formState({ secrets: {}, secrets_error: "the keyring is locked" }));
    expect(
      screen.getByText("Secret settings cannot be read: the keyring is locked"),
    ).toBeInTheDocument();
  });

  it("clears a saved value the setting no longer accepts when saved", () => {
    open(formState({ values: { refresh_seconds: 2 } }));
    expect(screen.getByText(/no longer fits this setting/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Refresh every (seconds)" })).toHaveValue(30);
    fireEvent.click(saveButton());
    expect(save.mock.calls[0][0]).toEqual({
      pluginId: "dev.example.pods",
      changes: { refresh_seconds: null },
    });
  });

  it("resets to defaults after the user confirms", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const confirm = screen.getByRole("alertdialog", { name: "Reset to defaults" });
    expect(confirm).toHaveTextContent("Saved secrets are cleared too.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep my settings" }));
    expect(reset).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reset" }));
    expect(reset).toHaveBeenCalledWith("dev.example.pods", expect.any(Object));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
