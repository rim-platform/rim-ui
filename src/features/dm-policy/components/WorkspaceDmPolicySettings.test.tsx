import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import {
  DmMembers,
  DmOutsideFloor,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { WorkspaceDmPolicySettings } from "./WorkspaceDmPolicySettings";

function serve(viewerRole: ServerMemberRoleGql) {
  routeRequests(requestMock, {
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole } }),
    "query WorkspaceDmPolicy": () => ({
      server: {
        id: "ws-1",
        dmOutsideFloor: DmOutsideFloor.NONE,
        dmMemberDefault: DmMembers.DIRECT,
      },
    }),
    "mutation SetWorkspaceDmPolicy": (vars) => ({ setWorkspaceDmPolicy: vars }),
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("WorkspaceDmPolicySettings", () => {
  it("lets the owner set the floor and the members' default", async () => {
    serve(ServerMemberRoleGql.OWNER);
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceDmPolicySettings serverId="ws-1" />);

    const closed = await screen.findByRole("radio", { name: /^Closed/ });
    await waitFor(() => expect(closed).toBeEnabled());
    await user.click(closed);
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetWorkspaceDmPolicy")).toEqual([
        {
          workspaceId: "ws-1",
          outsideFloor: DmOutsideFloor.CLOSED,
          memberDefault: DmMembers.DIRECT,
        },
      ]),
    );
    expect(closed).toBeChecked();

    await user.click(screen.getAllByRole("radio", { name: /^Requests/ })[0]);
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetWorkspaceDmPolicy")[1]).toEqual({
        workspaceId: "ws-1",
        outsideFloor: DmOutsideFloor.CLOSED,
        memberDefault: DmMembers.REQUESTS,
      }),
    );
  });

  it("shows the policy read-only to anyone else", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    renderWithProviders(<WorkspaceDmPolicySettings serverId="ws-1" />);

    const noFloor = await screen.findByRole("radio", { name: /^No floor/ });
    expect(noFloor).toBeChecked();
    expect(noFloor).toBeDisabled();
    expect(screen.getByText(/Only the owner changes these/)).toBeInTheDocument();
  });
});
