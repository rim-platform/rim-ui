import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspacePluginStatus } from "../../../../core/graphql/generated/schema-types";
import type { PluginInfo } from "../../types";
import type { RegistryItem } from "../hooks";
import { publisherOf } from "../model";
import { resetRegistrySession, useRegistryStore } from "../state";
import { helloEntry, installedHello, SERVER, verified } from "../testing/fixtures";
import { PUBLISHER } from "../testing/signedHelloWeb";

const registry = vi.hoisted(() => ({
  items: [] as RegistryItem[],
  installed: [] as PluginInfo[],
  desktop: true,
}));

vi.mock("../hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks")>()),
  usePluginPlatform: () => ({ platform: "desktop", enabled: true, desktop: registry.desktop }),
  useRegistryItems: () => ({
    items: registry.items,
    loaded: true,
    installed: registry.installed,
    workspaceName: "Acme",
  }),
}));

vi.mock("../installer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../installer")>()),
  installEntry: vi.fn(),
  stopPlugin: vi.fn(async () => {}),
  uninstallPlugin: vi.fn(async () => {}),
  keepAsLocal: vi.fn(async () => {}),
}));

vi.mock("../../api/usePluginList", () => ({
  usePluginList: () => ({ data: registry.installed }),
}));

vi.mock("../../../commands/api/useCommands", () => ({ reloadCommands: vi.fn() }));

vi.mock("./RegistryInstallDialog", () => ({
  RegistryInstallDialog: ({ item }: { item: RegistryItem }) => (
    <div role="dialog">Install dialog for {item.check.entry.pluginId}</div>
  ),
}));

import { installEntry, keepAsLocal, stopPlugin, uninstallPlugin } from "../installer";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { RegistryHost } from "./RegistryHost";

function requiredItem(hash: string): RegistryItem {
  return {
    check: verified({ entry: helloEntry({ status: WorkspacePluginStatus.REQUIRED }), hash }),
    publisher: publisherOf(PUBLISHER, "Ada", []),
    state: { kind: "notInstalled" },
    runsHere: true,
  };
}

function renderHost() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RegistryHost />
    </QueryClientProvider>,
  );
}

describe("the open workspace's registry on this device", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRegistrySession();
    useRegistryStore.setState({ installing: null, updates: [], removals: [] });
    useWorkspaceStore.setState({ workspaceId: SERVER });
    registry.items = [];
    registry.installed = [];
    registry.desktop = true;
  });

  it("offers required plugins once, and again after the statement changes", async () => {
    registry.items = [requiredItem("a".repeat(64))];
    const view = renderHost();
    expect(screen.getByText("Acme requires plugins")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Acme requires plugins")).not.toBeInTheDocument();
    view.unmount();

    // A new page: "Not now" is remembered for this statement.
    resetRegistrySession();
    renderHost().unmount();
    expect(screen.queryByText("Acme requires plugins")).not.toBeInTheDocument();

    registry.items = [requiredItem("b".repeat(64))];
    renderHost();
    expect(screen.getByText("Acme requires plugins")).toBeInTheDocument();
    expect(installEntry).not.toHaveBeenCalled();
  });

  it("never installs a required plugin on its own: review opens its install dialog", async () => {
    registry.items = [requiredItem("a".repeat(64))];
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "Review and install" }));
    expect(await screen.findByText(/Install dialog for dev.example.hello-web/)).toBeInTheDocument();
    expect(installEntry).not.toHaveBeenCalled();
  });

  it("lists required desktop plugins on the web as needing the desktop app", () => {
    registry.desktop = false;
    registry.items = [{ ...requiredItem("a".repeat(64)), runsHere: false }];
    renderHost();
    expect(screen.getByText("Needs the desktop app")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review and install" })).not.toBeInTheDocument();
  });

  it("stops a plugin whose entry was removed and removes it on Remove", async () => {
    registry.installed = [installedHello()];
    renderHost();
    expect(
      await screen.findByText(
        "Acme removed Hello Web from its plugins. Remove it from this device?",
      ),
    ).toBeInTheDocument();
    expect(stopPlugin).toHaveBeenCalledWith("desktop", registry.installed[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });
    expect(uninstallPlugin).toHaveBeenCalledWith("desktop", "dev.example.hello-web");
    expect(keepAsLocal).not.toHaveBeenCalled();
    await waitFor(() => expect(useRegistryStore.getState().removals).toHaveLength(0));
  });

  it("keeps it as a local plugin on Keep", async () => {
    registry.installed = [installedHello()];
    renderHost();
    await screen.findByText(/removed Hello Web/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    });
    expect(keepAsLocal).toHaveBeenCalledWith("desktop", "dev.example.hello-web");
    expect(uninstallPlugin).not.toHaveBeenCalled();
  });
});
