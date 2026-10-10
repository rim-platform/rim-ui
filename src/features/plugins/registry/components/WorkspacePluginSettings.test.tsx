import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";

import { ServerFeatureState } from "../../../../core/graphql/generated/schema-types";
import { RuntimeProvider } from "../../../../core/runtime/RuntimeProvider";
import { server } from "../../../../test/mocks/server";
import { serverInfoQueryClient, type FakeFeatures } from "../../../../test/serverInfo";

vi.mock("../../../workspaces/api/useMyServerRole", () => ({ useCanModerate: () => true }));

import { WorkspacePluginSettings } from "./WorkspacePluginSettings";

/** Serves an empty registry and counts how often it was asked. */
function serveRegistry(): { calls: number } {
  const seen = { calls: 0 };
  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as { query?: string };
      if (!body.query?.includes("workspacePlugins(")) return undefined;
      seen.calls += 1;
      return HttpResponse.json({ data: { workspacePlugins: [] } });
    }),
  );
  return seen;
}

function renderSettings(features: FakeFeatures = {}) {
  const client = serverInfoQueryClient(features);
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <RuntimeProvider>{children}</RuntimeProvider>
      </QueryClientProvider>
    );
  }
  return render(<WorkspacePluginSettings serverId="ws-1" />, { wrapper: Providers });
}

describe("WorkspacePluginSettings and the workspace_plugins switch", () => {
  it("shows the registry while the server runs workspace plugins", async () => {
    const seen = serveRegistry();
    renderSettings();

    expect(screen.getByRole("button", { name: /add from files/i })).toBeInTheDocument();
    await waitFor(() => expect(seen.calls).toBe(1));
  });

  it("shows the registry as switched off by the operator, and asks for nothing", async () => {
    const seen = serveRegistry();
    renderSettings({ workspace_plugins: ServerFeatureState.DISABLED });

    expect(
      screen.getByText("Workspace plugins are switched off on this server."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add from files/i })).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.calls).toBe(0);
  });
});
