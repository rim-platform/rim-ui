import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { makeConversation } from "../__fixtures__/conversations";

const requestMock = vi.fn();
const role = vi.hoisted(() => ({ canModerate: false }));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../workspaces/api/useMyServerRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../workspaces/api/useMyServerRole")>()),
  useCanModerate: () => role.canModerate,
}));

import { BrowseChannelsDialog } from "./BrowseChannelsDialog";

const general = makeConversation({ id: "c-general", title: "general", memberCount: 3 });
const designTalk = makeConversation({
  id: "c-design",
  title: "Design Talk",
  isMember: false,
  isArchived: true,
  archivedAt: "2026-10-20T00:00:00Z",
});

/** Answers the browse list and the archived list apart, by the filter each sends. */
function serve() {
  requestMock.mockImplementation(
    (_doc: unknown, variables: { filter?: { includeArchived?: boolean } }) =>
      Promise.resolve({
        channels: {
          items: variables.filter?.includeArchived ? [general, designTalk] : [general],
          pageInfo: { hasNext: false, hasPrev: false },
        },
      }),
  );
}

function archivedCalls() {
  return requestMock.mock.calls.filter(
    ([, variables]) =>
      (variables as { filter?: { includeArchived?: boolean } }).filter?.includeArchived,
  );
}

function renderDialog() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <BrowseChannelsDialog workspaceId="ws-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("BrowseChannelsDialog", () => {
  beforeEach(() => {
    requestMock.mockReset();
    serve();
  });

  afterEach(() => {
    role.canModerate = false;
  });

  it("lists archived channels under Archived for an owner", async () => {
    role.canModerate = true;
    renderDialog();

    const archived = await screen.findByRole("list", { name: "Archived channels" });
    expect(screen.getByRole("heading", { name: "Archived" })).toBeInTheDocument();
    expect(within(archived).getByText("Design Talk")).toBeInTheDocument();
    expect(within(archived).queryByText("general")).toBeNull();
    expect(within(archived).getByText(/^Archived/)).toBeInTheDocument();
    expect(within(archived).getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(within(archived).queryByRole("button", { name: /join/i })).toBeNull();
  });

  it("shows no Archived section to a member", async () => {
    renderDialog();

    await screen.findByText("general");
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(archivedCalls()).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Archived" })).toBeNull();
  });
});
