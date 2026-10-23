import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

import { graphqlClient } from "../../../core/graphql/client";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { JoinDefaultWorkspace } from "./JoinDefaultWorkspace";

const state = vi.hoisted(() => ({ servers: [] as { id: string }[] }));
vi.mock("../../updater/hooks/useServerInfo", () => ({
  useServerInfo: () => ({ info: { defaultWorkspace: "default-internal-id" } }),
}));
vi.mock("../../relay/runtime/useDirectSpaceRuntime", () => ({
  useLocalDirectSpaceId: () => "direct",
}));
vi.mock("../api/useMyServers", () => ({ useMyServers: () => ({ data: state.servers }) }));
vi.mock("../../../core/graphql/client", () => ({ graphqlClient: { request: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  state.servers = [];
  useWorkspaceStore.setState({ workspaceId: "direct" });
});

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <JoinDefaultWorkspace />
    </QueryClientProvider>,
  );
}

it("joins the default workspace from direct messages and opens it", async () => {
  vi.mocked(graphqlClient.request).mockResolvedValue({
    joinDefaultWorkspace: "default-internal-id",
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Join the default workspace" }));
  await waitFor(() => expect(useWorkspaceStore.getState().workspaceId).toBe("default-internal-id"));
});

it("explains an active ban without displaying the workspace id", async () => {
  vi.mocked(graphqlClient.request).mockRejectedValue(
    new Error("you are banned from this workspace"),
  );
  show();
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "You are banned from the default workspace.",
  );
  expect(screen.queryByText(/default-internal-id/)).not.toBeInTheDocument();
});

it("hides the offer when already joined", () => {
  state.servers = [{ id: "default-internal-id" }];
  show();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
