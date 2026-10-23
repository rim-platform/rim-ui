import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { JoinRequestStatus } from "../../../core/graphql/generated/schema-types";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import type { JoinRequestRow } from "../api/publicLink";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { MyJoinRequests } from "./MyJoinRequests";

function mine(id: string, workspaceName: string): JoinRequestRow {
  return {
    id,
    serverId: `ws-${id}`,
    workspaceName,
    userId: "u1",
    message: null,
    status: JoinRequestStatus.OPEN,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    user: null,
  };
}

function renderRequests() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MyJoinRequests />
    </QueryClientProvider>,
  );
}

describe("MyJoinRequests", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("lists the person's open requests with their workspace and when they asked", async () => {
    routeRequests(requestMock, {
      "query MyJoinRequests": () => ({
        myJoinRequests: [mine("a", "Acme"), mine("b", "Beta Club")],
      }),
    });
    renderRequests();

    const list = await screen.findByRole("list", { name: "Your join requests" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("my-join-request-a")).toHaveTextContent("Acme");
    expect(screen.getByTestId("my-join-request-a")).toHaveTextContent("Asked 3h ago");
    expect(screen.getByTestId("my-join-request-b")).toHaveTextContent("Beta Club");
  });

  it("renders nothing without open requests", async () => {
    routeRequests(requestMock, { "query MyJoinRequests": () => ({ myJoinRequests: [] }) });
    renderRequests();
    await waitFor(() => expect(callsTo(requestMock, "query MyJoinRequests")).toHaveLength(1));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("withdraws a request and drops it from the list", async () => {
    let open = [mine("a", "Acme"), mine("b", "Beta Club")];
    routeRequests(requestMock, {
      "query MyJoinRequests": () => ({ myJoinRequests: open }),
      "mutation WithdrawJoinRequest": (vars) => {
        open = open.filter((r) => r.id !== vars.requestId);
        return { withdrawJoinRequest: { id: vars.requestId, serverId: "ws-a" } };
      },
    });
    const user = userEvent.setup();
    renderRequests();

    await user.click(
      await screen.findByRole("button", { name: "Withdraw your request to join Acme" }),
    );

    await waitFor(() => expect(screen.queryByTestId("my-join-request-a")).toBeNull());
    expect(callsTo(requestMock, "mutation WithdrawJoinRequest")).toEqual([{ requestId: "a" }]);
    expect(toast.success).toHaveBeenCalledWith("Withdrew your request to join Acme");
    expect(screen.getByTestId("my-join-request-b")).toBeInTheDocument();
  });

  it("says why a withdrawal was refused", async () => {
    routeRequests(requestMock, {
      "query MyJoinRequests": () => ({ myJoinRequests: [mine("a", "Acme")] }),
      "mutation WithdrawJoinRequest": () => {
        throw graphqlError("CONFLICT", "this join request is no longer open");
      },
    });
    const user = userEvent.setup();
    renderRequests();
    await user.click(
      await screen.findByRole("button", { name: "Withdraw your request to join Acme" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This request is no longer open."),
    );
  });
});
