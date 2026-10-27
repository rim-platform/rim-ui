import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { toast } from "../../../shared/toast";
import { RenameWorkspaceDialog } from "./RenameWorkspaceDialog";

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.myServers(), [
    { id: "ws-1", name: "Alpha" },
    { id: "ws-2", name: "Beta" },
  ]);
  qc.setQueryData(queryKeys.server("ws-2"), { id: "ws-2", name: "Beta", viewerRole: "OWNER" });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <RenameWorkspaceDialog workspaceId="ws-2" name="Beta" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { qc, onClose };
}

describe("RenameWorkspaceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
  });

  it("prefills the name and renames with the trimmed one", async () => {
    routeRequests(requestMock, {
      "mutation RenameWorkspace": (vars) => ({
        renameWorkspace: { id: vars.serverId, name: vars.name },
      }),
    });
    const user = userEvent.setup();
    const { qc, onClose } = renderDialog();
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("Beta");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();

    await user.clear(input);
    await user.type(input, " Gamma ");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callsTo(requestMock, "mutation RenameWorkspace")).toEqual([
      { serverId: "ws-2", name: "Gamma" },
    ]);
    expect(qc.getQueryData<{ name: string }[]>(queryKeys.myServers())?.[1].name).toBe("Gamma");
    expect(qc.getQueryData<{ name: string }>(queryKeys.server("ws-2"))?.name).toBe("Gamma");
    expect(toast.success).toHaveBeenCalledWith("Renamed to Gamma");
  });

  it("shows a conflict inline", async () => {
    const message = 'you already own a workspace named "Gamma"';
    routeRequests(requestMock, {
      "mutation RenameWorkspace": () => {
        throw graphqlError("CONFLICT", message);
      },
    });
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "Gamma");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
