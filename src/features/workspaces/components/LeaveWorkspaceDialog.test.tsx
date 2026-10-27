import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
const spaces = vi.hoisted(() => ({ forgetSpace: vi.fn(async () => undefined) }));
vi.mock("../../relay/state/spaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../relay/state/spaces")>()),
  forgetSpace: spaces.forgetSpace,
}));

import { toast } from "../../../shared/toast";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../state/useWorkspaceStore";
import { LeaveWorkspaceDialog } from "./LeaveWorkspaceDialog";

function renderDialog(workspaceId = "ws-2", onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.myServers(), [
    { id: "ws-1", name: "Alpha" },
    { id: "ws-2", name: "Beta" },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <LeaveWorkspaceDialog workspaceId={workspaceId} name="Beta" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { qc, onClose };
}

describe("LeaveWorkspaceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-2" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useRelayStore.getState().reset();
  });

  it("leaves after confirming and drops the workspace", async () => {
    routeRequests(requestMock, { "mutation LeaveWorkspace": () => ({ leaveWorkspace: true }) });
    const { qc, onClose } = renderDialog();
    expect(screen.getByText("Leave Beta?")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Leave workspace" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation LeaveWorkspace")).toEqual([{ serverId: "ws-2" }]);
    expect(qc.getQueryData<{ id: string }[]>(queryKeys.myServers())?.map((s) => s.id)).toEqual([
      "ws-1",
    ]);
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("You left Beta");
  });

  it("keeps the dialog open with the server's message", async () => {
    const message = "the owner cannot leave a workspace; transfer ownership or delete it first";
    routeRequests(requestMock, {
      "mutation LeaveWorkspace": () => {
        throw graphqlError("VALIDATION", message);
      },
    });
    const { onClose } = renderDialog();

    await userEvent.setup().click(screen.getByRole("button", { name: "Leave workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
  });

  it("forgets a workspace on another server", async () => {
    useRelayStore.setState({
      spaces: {
        "ws-r": { account: "a", spaceId: "ws-r", hostServerId: "rims1_h", kind: "workspace" },
      },
    });
    routeRequests(requestMock, { "mutation LeaveWorkspace": () => ({ leaveWorkspace: true }) });
    const { onClose } = renderDialog("ws-r");

    await userEvent.setup().click(screen.getByRole("button", { name: "Leave workspace" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(spaces.forgetSpace).toHaveBeenCalledWith("ws-r");
  });

  it("says a server too old for it", async () => {
    routeRequests(requestMock, {
      "mutation LeaveWorkspace": () => {
        throw Object.assign(new Error("Cannot query field"), {
          response: { errors: [{ message: 'Unknown field "leaveWorkspace"' }] },
        });
      },
    });
    renderDialog();

    await userEvent.setup().click(screen.getByRole("button", { name: "Leave workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This workspace's server does not support this yet.",
    );
  });
});
