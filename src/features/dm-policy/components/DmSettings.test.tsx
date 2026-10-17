import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import {
  DmFloorSourceKind,
  DmMembers,
  DmOutside,
} from "../../../core/graphql/generated/schema-types";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";
import type { MyDmSettingsView } from "../api/dmPolicy";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { DmSettings } from "./DmSettings";

function settings(overrides: Partial<MyDmSettingsView> = {}): MyDmSettingsView {
  return {
    outside: DmOutside.REQUESTS,
    workspaces: [
      { workspaceId: "ws-1", members: DmMembers.DIRECT, memberDefault: DmMembers.REQUESTS },
    ],
    effectiveOutside: DmOutside.REQUESTS,
    outsideFloorFrom: null,
    ...overrides,
  };
}

function serve(current: MyDmSettingsView) {
  routeRequests(requestMock, {
    "query MyDmSettings": () => ({ myDmSettings: current }),
    "query MyServers": () => ({ myServers: [{ id: "ws-1", name: "Acme", owner: null }] }),
    "mutation SetMyDmSettings": (vars) => ({
      setMyDmSettings: { ...current, outside: vars.outside, effectiveOutside: vars.outside },
    }),
    "mutation SetMyWorkspaceDmSetting": (vars) => ({
      setMyWorkspaceDmSetting: {
        ...current,
        workspaces: current.workspaces.map((w) => ({ ...w, members: vars.members })),
      },
    }),
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DmSettings", () => {
  it("saves the choice for people outside and for each workspace's members", async () => {
    serve(settings());
    const user = userEvent.setup();
    renderWithProviders(<DmSettings />);

    await user.click(await screen.findByRole("radio", { name: /Nobody/ }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetMyDmSettings")).toEqual([
        { outside: DmOutside.NONE },
      ]),
    );
    expect(screen.getByRole("radio", { name: /Nobody/ })).toBeChecked();

    const row = (await screen.findByText("Acme")).closest("li")!;
    expect(within(row).getByText("Workspace default: Requests")).toBeInTheDocument();
    expect(within(row).getByRole("radio", { name: "Direct" })).toBeChecked();
    await user.click(within(row).getByRole("radio", { name: "Requests" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetMyWorkspaceDmSetting")).toEqual([
        { workspaceId: "ws-1", members: DmMembers.REQUESTS },
      ]),
    );
    expect(within(row).getByRole("radio", { name: "Requests" })).toBeChecked();
  });

  it.each([
    [{ kind: DmFloorSourceKind.OPERATOR }, "Set by your server's operator"],
    [
      { kind: DmFloorSourceKind.WORKSPACE, workspaceId: "ws-1", workspaceName: "Acme" },
      "Set by the workspace Acme",
    ],
  ])("explains a floor that refuses DMs from outside and locks the choice", async (floor, text) => {
    serve(settings({ effectiveOutside: DmOutside.NONE, outsideFloorFrom: floor }));
    renderWithProviders(<DmSettings />);

    expect(await screen.findByText(new RegExp(`^${text}`))).toBeInTheDocument();
    const outside = screen.getByRole("group", { name: "People who share no workspace with you" });
    const nobody = within(outside).getByRole("radio", { name: /^Nobody/ });
    expect(nobody).toBeChecked();
    expect(nobody).toBeDisabled();
    expect(within(outside).getByRole("radio", { name: /^Requests/ })).toBeDisabled();
  });
});
