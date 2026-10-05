import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { WorkspaceFeature } from "../../../core/graphql/generated/schema-types";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { WorkspaceFeatureSettings } from "./WorkspaceFeatureSettings";

/** Serves the features query with a fixed state; `setWorkspaceFeature` uses `onSet`. */
function serve(enabled: boolean, onSet: (variables: unknown) => Promise<unknown>) {
  requestMock.mockImplementation((document: unknown, variables: unknown) => {
    const text = typeof document === "string" ? document : "";
    if (text.includes("setWorkspaceFeature(")) return onSet(variables);
    if (text.includes("workspaceFeatures(")) {
      return Promise.resolve({
        workspaceFeatures: [{ feature: WorkspaceFeature.INCIDENTS, enabled, updatedAt: null }],
      });
    }
    return new Promise(() => {});
  });
}

function setCalls() {
  return requestMock.mock.calls.filter(([document]) =>
    String(document).includes("setWorkspaceFeature("),
  );
}

describe("WorkspaceFeatureSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("lists the incidents feature with its copy and current state", async () => {
    serve(true, () => new Promise(() => {}));
    renderWithProviders(<WorkspaceFeatureSettings serverId="srv-1" />);

    const toggle = await screen.findByRole("switch", { name: "Incidents and on-call" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "Incident timelines, on-call schedules, escalation policies and alert webhooks. Turning this off hides the module; nothing is deleted.",
      ),
    ).toBeInTheDocument();
  });

  it("turns a feature on immediately with the right variables", async () => {
    const onSet = vi.fn(() =>
      Promise.resolve({
        setWorkspaceFeature: {
          feature: WorkspaceFeature.INCIDENTS,
          enabled: true,
          updatedAt: "2026-10-04T00:00:00Z",
        },
      }),
    );
    serve(false, onSet);
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceFeatureSettings serverId="srv-1" />);

    await user.click(await screen.findByRole("switch", { name: "Incidents and on-call" }));

    await waitFor(() =>
      expect(onSet).toHaveBeenCalledWith({
        serverId: "srv-1",
        feature: WorkspaceFeature.INCIDENTS,
        enabled: true,
      }),
    );
  });

  it("asks for confirmation before turning a feature off, then sends enabled: false", async () => {
    const onSet = vi.fn(() =>
      Promise.resolve({
        setWorkspaceFeature: {
          feature: WorkspaceFeature.INCIDENTS,
          enabled: false,
          updatedAt: "2026-10-04T00:00:00Z",
        },
      }),
    );
    serve(true, onSet);
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceFeatureSettings serverId="srv-1" />);

    await user.click(await screen.findByRole("switch", { name: "Incidents and on-call" }));
    expect(setCalls()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Turn off" }));

    await waitFor(() =>
      expect(onSet).toHaveBeenCalledWith({
        serverId: "srv-1",
        feature: WorkspaceFeature.INCIDENTS,
        enabled: false,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument(),
    );
  });

  it("cancelling the confirmation sends nothing", async () => {
    serve(true, () => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceFeatureSettings serverId="srv-1" />);

    await user.click(await screen.findByRole("switch", { name: "Incidents and on-call" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
    expect(setCalls()).toHaveLength(0);
  });

  it("shows the server's error message when the change is refused", async () => {
    serve(false, () =>
      Promise.reject({
        response: {
          errors: [
            {
              message: "Only the workspace owner can change workspace features",
              extensions: { code: "FORBIDDEN" },
            },
          ],
        },
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<WorkspaceFeatureSettings serverId="srv-1" />);

    await user.click(await screen.findByRole("switch", { name: "Incidents and on-call" }));

    expect(
      await screen.findByText("Only the workspace owner can change workspace features"),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Incidents and on-call" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
