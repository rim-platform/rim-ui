import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClientError } from "graphql-request";

import { createTestQueryClient } from "../../../test/utils";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

beforeEach(() => vi.clearAllMocks());

describe("CreateWorkspaceDialog", () => {
  it("shows the server's message when the workspace is refused", async () => {
    const user = userEvent.setup();
    const message = "You already own a workspace named Ops";
    requestMock.mockRejectedValue(
      new ClientError(
        {
          status: 200,
          headers: new Headers(),
          errors: [{ message, extensions: { code: "CONFLICT" } }],
        },
        { query: "" },
      ),
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <CreateWorkspaceDialog onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole("textbox"), "Ops");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/"response"/)).not.toBeInTheDocument();
  });
});
