import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { DigestFrequency, NotificationLevel } from "../../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useNotificationSettingsStore } from "../state/useNotificationSettingsStore";
import type { NotificationSettingsData } from "../api/useNotificationSettings";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

import { NotificationSettings } from "./NotificationSettings";

const defaults: NotificationSettingsData = {
  serverId: "ws-1",
  defaultLevel: NotificationLevel.ALL,
  keywords: ["outage"],
  dnd: null,
  dndPaused: false,
  dndPausedUntil: null,
  digest: DigestFrequency.OFF,
};

function serve(
  settings: NotificationSettingsData = defaults,
  overrides: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  routeRequests(requestMock, {
    "query MyNotificationSettings": () => ({ myNotificationSettings: settings }),
    "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: "MEMBER" } }),
    "mutation UpdateNotificationSettings": (vars) => {
      const input = vars.input as Omit<NotificationSettingsData, "serverId">;
      return { updateNotificationSettings: { ...settings, ...input } };
    },
    "mutation SetDoNotDisturb": (vars) => ({
      setDoNotDisturb: {
        ...settings,
        dndPaused: vars.paused,
        dndPausedUntil: vars.paused ? (vars.until ?? null) : null,
      },
    }),
    ...overrides,
  });
}

async function renderSettings() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NotificationSettings />
    </QueryClientProvider>,
  );
  await screen.findByRole("form", { name: "Workspace notification rules" });
  return qc;
}

function keywordInput() {
  return screen.getByLabelText("Keyword alerts");
}

describe("NotificationSettings", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useNotificationSettingsStore.setState({ enabled: true, soundEnabled: true, showPreview: true });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("saves the rules with the server's variables", async () => {
    serve();
    await renderSettings();

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Mentions" }));
    fireEvent.change(keywordInput(), { target: { value: "Deploy" } });
    fireEvent.keyDown(keywordInput(), { key: "Enter" });
    fireEvent.click(screen.getByRole("switch", { name: "Quiet hours" }));
    fireEvent.change(screen.getByLabelText("Email digest"), {
      target: { value: DigestFrequency.DAILY },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UpdateNotificationSettings")).toEqual([
        {
          serverId: "ws-1",
          input: {
            defaultLevel: NotificationLevel.MENTIONS,
            keywords: ["outage", "deploy"],
            dnd: {
              start: "22:00",
              end: "08:00",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            digest: DigestFrequency.DAILY,
          },
        },
      ]),
    );
    expect(callsTo(requestMock, "mutation SetDoNotDisturb")).toEqual([]);
  });

  it("loads a saved window and turning it off sends dnd: null", async () => {
    serve({
      ...defaults,
      dnd: { start: "21:30:00", end: "07:00:00", timezone: "Europe/Prague" },
    });
    await renderSettings();

    expect(screen.getByLabelText("From")).toHaveValue("21:30");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Prague");
    fireEvent.click(screen.getByRole("switch", { name: "Quiet hours" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UpdateNotificationSettings")[0]).toMatchObject({
        input: { dnd: null },
      }),
    );
  });

  it("adds keywords on comma, removes them, and lower-cases like the server", async () => {
    serve();
    await renderSettings();

    fireEvent.change(keywordInput(), { target: { value: "Release, HOTFIX," } });
    expect(screen.getByText("release")).toBeInTheDocument();
    expect(screen.getByText("hotfix")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove keyword outage" }));
    expect(screen.queryByText("outage")).not.toBeInTheDocument();
  });

  it("refuses keywords outside 2 to 40 characters and more than 20", async () => {
    serve({ ...defaults, keywords: Array.from({ length: 20 }, (_, i) => `word${i}`) });
    await renderSettings();

    fireEvent.change(keywordInput(), { target: { value: "a" } });
    fireEvent.keyDown(keywordInput(), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Keywords must be 2 to 40 characters long.",
    );

    fireEvent.change(keywordInput(), { target: { value: "x".repeat(41) } });
    fireEvent.keyDown(keywordInput(), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Keywords must be 2 to 40 characters long.",
    );

    fireEvent.change(keywordInput(), { target: { value: "twentyfirst" } });
    fireEvent.keyDown(keywordInput(), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("At most 20 keywords are allowed.");

    // An invalid pending keyword blocks Save.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(callsTo(requestMock, "mutation UpdateNotificationSettings")).toEqual([]);
  });

  it("shows the server's message when the save is refused", async () => {
    serve(defaults, {
      "mutation UpdateNotificationSettings": () => {
        throw graphqlError("VALIDATION", "unknown timezone: Mars/Olympus");
      },
    });
    await renderSettings();

    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("unknown timezone: Mars/Olympus");
  });

  it("refuses a window that starts and ends at the same time", async () => {
    serve({ ...defaults, dnd: { start: "22:00", end: "08:00", timezone: "UTC" } });
    await renderSettings();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "22:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Quiet hours must start and end at different times.",
    );
    expect(callsTo(requestMock, "mutation UpdateNotificationSettings")).toEqual([]);
  });

  it("pauses for one hour at once, without Save", async () => {
    serve();
    await renderSettings();

    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "For 1 hour" }));

    await waitFor(() => expect(callsTo(requestMock, "mutation SetDoNotDisturb")).toHaveLength(1));
    const vars = callsTo(requestMock, "mutation SetDoNotDisturb")[0];
    expect(vars).toMatchObject({ serverId: "ws-1", paused: true });
    const until = Date.parse(vars.until as string);
    expect(until - before).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(until - before).toBeLessThanOrEqual(61 * 60 * 1000);
    expect(await screen.findByTestId("pause-status")).toHaveTextContent("Paused until");
    expect(callsTo(requestMock, "mutation UpdateNotificationSettings")).toEqual([]);
  });

  it("treats a timed pause that has ended as off", async () => {
    serve({ ...defaults, dndPaused: true, dndPausedUntil: "2000-01-01T00:00:00Z" });
    await renderSettings();
    expect(screen.getByTestId("pause-status")).toHaveTextContent("Not paused");
    expect(screen.queryByRole("button", { name: "Turn off pause" })).not.toBeInTheDocument();
  });

  it("pauses until a custom time and turns the pause off", async () => {
    serve({ ...defaults, dndPaused: true, dndPausedUntil: null });
    await renderSettings();

    expect(screen.getByTestId("pause-status")).toHaveTextContent(
      "Paused until you turn it back on",
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn off pause" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetDoNotDisturb")).toEqual([
        { serverId: "ws-1", paused: false, until: null },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom…" }));
    fireEvent.change(screen.getByLabelText("Pause until"), {
      target: { value: "2000-01-01T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a time in the future.");

    fireEvent.change(screen.getByLabelText("Pause until"), {
      target: { value: "2999-01-01T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(callsTo(requestMock, "mutation SetDoNotDisturb")).toHaveLength(2));
    expect(callsTo(requestMock, "mutation SetDoNotDisturb")[1]).toEqual({
      serverId: "ws-1",
      paused: true,
      until: new Date("2999-01-01T10:00").toISOString(),
    });
  });

  it("keeps the device toggles local: no request, untouched by Save", async () => {
    serve();
    await renderSettings();

    const device = screen.getByRole("region", { name: "This device" });
    fireEvent.click(within(device).getByRole("switch", { name: "Sound" }));
    expect(useNotificationSettingsStore.getState().soundEnabled).toBe(false);
    expect(callsTo(requestMock, "mutation")).toEqual([]);

    fireEvent.click(screen.getByRole("radio", { name: "Mentions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UpdateNotificationSettings")).toHaveLength(1),
    );
    expect(useNotificationSettingsStore.getState()).toMatchObject({
      enabled: true,
      soundEnabled: false,
      showPreview: true,
    });
  });
});
