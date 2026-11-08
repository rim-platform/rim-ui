import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientError } from "graphql-request";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { RuntimeProvider } from "../../../core/runtime/RuntimeProvider";
import { createTestQueryClient } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import {
  baseReadHandlers,
  callsTo,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useAgentRecordStore } from "../../agents/state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../../agents/state/useConnectedAgentsStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useConnectionStore } from "../../system/state/useConnectionStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { HomeBox, HomeLayoutDoc } from "../layout/homeLayout";
import { useHomeEditStore } from "../state/useHomeEditStore";
import { useHomeHiddenStore, useHomeLayoutStore } from "../state/useHomeLayoutStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../relay/api/useDmRequests", () => ({
  usePendingDmRequestCounts: () => new Map(),
}));
const server = vi.hoisted(() => ({ capabilities: ["home_layout"] as string[] }));
vi.mock("../../updater/hooks/useServerInfo", () => ({
  useServerInfo: () => ({
    info: { defaultWorkspace: null, capabilities: server.capabilities },
  }),
}));
vi.mock("../../updater/api/serverCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../updater/api/serverCapabilities")>()),
  serverHasCapability: async (capability: string) => server.capabilities.includes(capability),
}));
const available = vi.hoisted(() => ({ agent: true }));
vi.mock("../../agent/agentAvailability", () => ({ agentAvailable: () => available.agent }));

import { HomePage } from "./HomePage";

const SERVERS = [
  { id: "ws-1", name: "Alpha", owner: { id: "u-1", username: "alice", displayName: "Alice" } },
];

const box = (id: string, kind: string, width: "half" | "full" = "half", extra = {}): HomeBox => ({
  id,
  kind,
  width,
  ...extra,
});

const layoutOf = (...boxes: HomeBox[]): HomeLayoutDoc => ({ version: 1, boxes });

interface Stored {
  layout: unknown;
  editedAt: string;
}

const state = vi.hoisted(() => ({
  stored: null as Stored | null,
  save: null as ((vars: Record<string, unknown>) => unknown) | null,
}));

function serve() {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query MyServers": () => ({ myServers: SERVERS }),
    "query MyNotifications": () => ({
      myNotifications: { items: [], next: null, pageInfo: { hasNext: false } },
    }),
    "query Server": (vars) => ({
      server: { id: vars.serverId, name: "x", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    "query HomeLayout": () => ({ homeLayout: state.stored }),
    "mutation SaveHomeLayout": (vars) => {
      if (state.save) return state.save(vars);
      state.stored = { layout: vars.layout, editedAt: vars.editedAt as string };
      return { saveHomeLayout: { kept: true, layout: state.stored } };
    },
    "mutation ResetHomeLayout": () => {
      state.stored = null;
      return { resetHomeLayout: true };
    },
  });
}

function renderHome() {
  const qc = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={qc}>
      <RuntimeProvider>
        <HomePage />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return { qc, ...view };
}

/** The ids of the boxes Home shows, in order, the one-line ones included. */
function shownBoxes(): string[] {
  return Array.from(document.querySelectorAll("[data-box-id]")).map(
    (el) => el.getAttribute("data-box-id") ?? "",
  );
}

function saves(): Record<string, unknown>[] {
  return callsTo(requestMock, "mutation SaveHomeLayout");
}

/** A refusal shaped as `graphql-request` throws it, its request and variables included. */
function refused(message: string, variables: Record<string, unknown>): ClientError {
  return new ClientError(
    { errors: [{ message, extensions: { code: "VALIDATION" } }], status: 200, headers: {} },
    { query: "mutation SaveHomeLayout", variables },
  );
}

async function startEditing(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Edit Home" }));
  await screen.findByRole("heading", { level: 1, name: "Editing Home" });
}

/** Moves the box `name` one place up or down through its More menu. */
async function moveVia(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  direction: "up" | "down",
) {
  await user.click(screen.getByRole("button", { name: `More for ${name}` }));
  const menu = await screen.findByRole("menu", { name: `More for ${name}` });
  await user.click(within(menu).getByRole("menuitem", { name: `Move ${direction}` }));
}

/**
 * Lays the boxes of the editor out in one column, 100 pixels apart, as jsdom draws nothing; the
 * drag sensors read where the boxes are from this.
 */
function layOutBoxesInAColumn() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const item = this.closest("li[data-box-id]");
    const items = Array.from(document.querySelectorAll("li[data-box-id]"));
    const index = item ? items.indexOf(item) : 0;
    const top = index * 100;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      right: 300,
      bottom: top + 80,
      width: 300,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

describe("Home made of boxes", () => {
  beforeEach(() => {
    requestMock.mockReset();
    state.stored = null;
    state.save = null;
    server.capabilities = ["home_layout"];
    available.agent = true;
    useShellStore.getState().reset();
    useShellStore.setState({ shellWidth: "wide" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    useConnectedAgentsStore.setState({ agents: [] });
    useAgentRecordStore.setState({ entries: [] });
    useHomeLayoutStore.setState({ copy: null, pending: null, changedElsewhere: false });
    useHomeHiddenStore.setState({ hidden: [] });
    useHomeEditStore.getState().stop();
    useOfflineStore.setState({ offline: false });
    useConnectionStore.setState({ status: "connected" });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("shows the default layout, with the agents' runs where agents are connected, and saves nothing on opening", async () => {
    serve();
    renderHome();
    await screen.findByText("Nothing waiting.");
    expect(shownBoxes()).toEqual(["waiting", "mentions", "unread"]);
    await waitFor(() => expect(callsTo(requestMock, "query HomeLayout")).toHaveLength(1));

    act(() =>
      useConnectedAgentsStore.setState({
        agents: [
          {
            id: "a1",
            name: "Claude Code",
            tokenHash: "h",
            pairedAt: "2026-11-06T10:00:00.000Z",
            grants: {},
            pluginApprovals: {},
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(shownBoxes()).toEqual(["waiting", "mentions", "unread", "agentRuns"]),
    );
    expect(saves()).toHaveLength(0);
  });

  it("asks nothing of a server without Home layouts and offers no Edit Home there", async () => {
    server.capabilities = [];
    useHomeLayoutStore.setState({
      copy: { layout: layoutOf(box("unread", "unread")), editedAt: "2026-11-07T10:00:00.000Z" },
    });
    serve();
    renderHome();
    await screen.findByText("Nothing waiting.");
    expect(shownBoxes()).toEqual(["waiting", "mentions", "unread"]);
    expect(screen.queryByRole("button", { name: "Edit Home" })).not.toBeInTheDocument();
    expect(callsTo(requestMock, "query HomeLayout")).toHaveLength(0);
  });

  it("shows the stored layout, and Done without a change saves nothing", async () => {
    state.stored = {
      layout: layoutOf(box("unread", "unread", "full"), box("waiting", "waiting")),
      editedAt: "2026-11-07T10:00:00.000Z",
    };
    serve();
    const user = userEvent.setup();
    renderHome();
    await waitFor(() => expect(shownBoxes()).toEqual(["unread", "waiting"]));
    await startEditing(user);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(saves()).toHaveLength(0);
  });

  it("moves, resizes, removes and adds boxes, and Done saves them with the time it was pressed", async () => {
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    await moveVia(user, "Unread", "up");
    await user.click(screen.getByRole("button", { name: "Make Waiting for you full width" }));
    await user.click(screen.getByRole("button", { name: "Remove Mentions and replies" }));
    await user.click(screen.getByRole("button", { name: "Add Mentions and replies" }));
    const before = Date.now();
    await user.click(screen.getByRole("button", { name: "Done" }));
    const after = Date.now();

    await waitFor(() => expect(saves()).toHaveLength(1));
    const [vars] = saves();
    expect(vars.layout).toEqual(
      layoutOf(
        box("waiting", "waiting", "full"),
        box("unread", "unread"),
        box("mentions", "mentions"),
      ),
    );
    const editedAt = Date.parse(vars.editedAt as string);
    expect(editedAt).toBeGreaterThanOrEqual(before);
    expect(editedAt).toBeLessThanOrEqual(after);
    await waitFor(() => expect(shownBoxes()).toEqual(["waiting", "unread", "mentions"]));
    expect(useHomeLayoutStore.getState().pending).toBeNull();
    expect(useHomeLayoutStore.getState().copy?.layout).toEqual(vars.layout);
  });

  it("drops the changes on Cancel, and Escape asks first when something changed", async () => {
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    await moveVia(user, "Unread", "up");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(shownBoxes()).toEqual(["waiting", "mentions", "unread"]);

    await startEditing(user);
    await user.keyboard("{Escape}");
    await screen.findByRole("heading", { level: 1, name: "Home" });

    await startEditing(user);
    await moveVia(user, "Unread", "up");
    await user.keyboard("{Escape}");
    const dialog = await screen.findByRole("dialog", { name: "Discard your changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(shownBoxes()).toEqual(["waiting", "mentions", "unread"]);
    expect(saves()).toHaveLength(0);
  });

  it("moves a box through its More menu, keeping focus on that menu's button", async () => {
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    await moveVia(user, "Mentions and replies", "up");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "More for Mentions and replies" })).toHaveFocus(),
    );
    expect(document.querySelector('p[aria-live="polite"]')).toHaveTextContent(
      "Moved Mentions and replies to position 1 of 3",
    );
    expect(shownBoxes().slice(0, 3)).toEqual(["mentions", "waiting", "unread"]);
    // The first box offers no Move up.
    await user.click(screen.getByRole("button", { name: "More for Mentions and replies" }));
    const menu = await screen.findByRole("menu", { name: "More for Mentions and replies" });
    expect(within(menu).queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Remove" })).toBeInTheDocument();
  });

  it("reorders from the keyboard through the handle, saying where the box goes", async () => {
    const rects = layOutBoxesInAColumn();
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    const handle = screen.getByRole("button", { name: "Reorder Waiting for you" });
    handle.focus();
    await user.keyboard(" ");
    expect(
      await screen.findByText("Picked up Waiting for you, position 1 of 3"),
    ).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByText("Moved to position 2 of 3")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(await screen.findByText("Dropped at position 2 of 3")).toBeInTheDocument();
    await waitFor(() => expect(shownBoxes()).toEqual(["mentions", "waiting", "unread"]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reorder Waiting for you" })).toHaveFocus(),
    );
    rects.mockRestore();
  });

  it("reorders by dragging a box's header with the pointer", async () => {
    const rects = layOutBoxesInAColumn();
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    const header = screen.getByRole("button", { name: "Reorder Waiting for you" })
      .parentElement as HTMLElement;
    const point = (y: number) => ({ isPrimary: true, button: 0, clientX: 20, clientY: y });
    fireEvent.pointerDown(header, point(20));
    fireEvent.pointerMove(document, point(40));
    fireEvent.pointerMove(document, point(240));
    fireEvent.pointerUp(document, point(240));
    await waitFor(() => expect(shownBoxes()).toEqual(["mentions", "unread", "waiting"]));
    // A drag takes the clicks of the next 50 ms for itself; the next test starts after them.
    await new Promise((resolve) => setTimeout(resolve, 60));
    rects.mockRestore();
  });

  it("cancels only the drag on Escape, leaving the box and the edit as they were", async () => {
    const rects = layOutBoxesInAColumn();
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    screen.getByRole("button", { name: "Reorder Waiting for you" }).focus();
    await user.keyboard(" ");
    await screen.findByText("Picked up Waiting for you, position 1 of 3");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");
    expect(await screen.findByText("Cancelled, back at position 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Editing Home" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(shownBoxes().slice(0, 3)).toEqual(["waiting", "mentions", "unread"]);
    rects.mockRestore();
  });

  it("shows on the width button what pressing it does, its name starting with those words", async () => {
    serve();
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    const make = screen.getByRole("button", { name: "Make Waiting for you full width" });
    expect(make).toHaveTextContent("Make full");
    await user.click(make);
    const back = screen.getByRole("button", { name: "Make Waiting for you half width" });
    expect(back).toHaveTextContent("Make half");
    expect(back).toHaveFocus();
  });

  it("keeps a box of a kind it does not know in its place and saves it back unchanged", async () => {
    const future = box("f", "futureThing", "full", { settings: { x: 1 }, extra: "kept" });
    state.stored = {
      layout: layoutOf(box("waiting", "waiting"), future, box("mentions", "mentions")),
      editedAt: "2026-11-07T10:00:00.000Z",
    };
    serve();
    const user = userEvent.setup();
    renderHome();
    expect(await screen.findByText("This box needs a newer version of RIM")).toBeInTheDocument();
    await waitFor(() => expect(shownBoxes()).toEqual(["waiting", "f", "mentions"]));
    await startEditing(user);
    await moveVia(user, "Waiting for you", "down");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0].layout).toEqual(
      layoutOf(future, box("waiting", "waiting"), box("mentions", "mentions")),
    );
  });

  it("hides a box this device can't run here only, and never sends the hidden list", async () => {
    available.agent = false;
    state.stored = {
      layout: layoutOf(box("agentRuns", "agentRuns"), box("waiting", "waiting")),
      editedAt: "2026-11-07T10:00:00.000Z",
    };
    serve();
    const user = userEvent.setup();
    renderHome();
    const line = await screen.findByRole("group", { name: "Your agents' runs" });
    expect(line).toHaveTextContent("Your agents' runs needs the desktop app");
    await user.click(within(line).getByRole("button", { name: "Don't show on this device" }));
    expect(screen.queryByRole("group", { name: "Your agents' runs" })).not.toBeInTheDocument();
    expect(useHomeHiddenStore.getState().hidden).toEqual(["agentRuns"]);

    await startEditing(user);
    const panel = screen.getByRole("complementary", { name: "Add a box" });
    expect(within(panel).getByText("Your agents' runs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make Waiting for you full width" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    const [vars] = saves();
    expect(Object.keys(vars).sort()).toEqual(["editedAt", "layout"]);
    expect(JSON.stringify(vars)).not.toContain("hidden");
    expect(vars.layout).toEqual(
      layoutOf(box("agentRuns", "agentRuns"), box("waiting", "waiting", "full")),
    );
  });

  it("asks before removing a box this device can't run from every device", async () => {
    available.agent = false;
    state.stored = {
      layout: layoutOf(box("agentRuns", "agentRuns"), box("waiting", "waiting")),
      editedAt: "2026-11-07T10:00:00.000Z",
    };
    serve();
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole("group", { name: "Your agents' runs" });
    await startEditing(user);
    await user.click(screen.getByRole("button", { name: "Remove Your agents' runs" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove from Home on every device?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(
      screen.queryByRole("button", { name: "Remove Your agents' runs" }),
    ).not.toBeInTheDocument();
  });

  it("shows the device's copy and says so while the server can't be reached", async () => {
    useHomeLayoutStore.setState({
      copy: {
        layout: layoutOf(box("unread", "unread"), box("mentions", "mentions")),
        editedAt: "2026-11-07T10:00:00.000Z",
      },
    });
    useConnectionStore.setState({ status: "disconnected" });
    serve();
    requestMock.mockImplementation((document: unknown) => {
      if (String(document).includes("query HomeLayout")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return new Promise(() => {});
    });
    renderHome();
    expect(await screen.findByText(/Can't reach .*Showing your saved layout/)).toBeInTheDocument();
    expect(shownBoxes()).toEqual(["unread", "mentions"]);
    expect(screen.getAllByText("not up to date")).toHaveLength(2);
  });

  it("keeps an edit made without the server and sends it once the server answers", async () => {
    serve();
    state.save = () => {
      throw new TypeError("Failed to fetch");
    };
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    await moveVia(user, "Unread", "up");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(saves()).toHaveLength(1));
    const pending = useHomeLayoutStore.getState().pending;
    expect(pending?.layout.boxes.map((b) => b.id)).toEqual(["waiting", "unread", "mentions"]);
    expect(shownBoxes()).toEqual(["waiting", "unread", "mentions"]);

    state.save = null;
    act(() => useConnectionStore.setState({ status: "disconnected" }));
    act(() => useConnectionStore.setState({ status: "connected" }));
    await waitFor(() => expect(saves()).toHaveLength(2));
    expect(saves()[1]).toEqual(saves()[0]);
    await waitFor(() => expect(useHomeLayoutStore.getState().pending).toBeNull());
  });

  it("drops an edit the server refuses and says why, without the layout", async () => {
    const { toast } = await import("../../../shared/toast");
    const { logger } = await import("../../../core/logger");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    serve();
    state.save = (vars) => {
      throw refused("A Home layout holds at most 30 boxes", vars);
    };
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    await moveVia(user, "Unread", "up");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Your Home layout wasn't saved: A Home layout holds at most 30 boxes",
      ),
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("A Home layout holds at most 30 boxes");
    expect(logged).not.toContain("editedAt");
    expect(logged).not.toContain("mentions");
    warn.mockRestore();
    expect(useHomeLayoutStore.getState().pending).toBeNull();
    expect(shownBoxes()).toEqual(["waiting", "mentions", "unread"]);
  });

  it("shows the layout another device saved later, once, when the save loses", async () => {
    const theirs = layoutOf(box("mentions", "mentions", "full"));
    serve();
    state.save = () => ({
      saveHomeLayout: {
        kept: false,
        layout: { layout: theirs, editedAt: new Date(Date.now() + 1000).toISOString() },
      },
    });
    const user = userEvent.setup();
    renderHome();
    await startEditing(user);
    await moveVia(user, "Unread", "up");
    await user.click(screen.getByRole("button", { name: "Done" }));
    const notice = await screen.findByText(
      "Your layout changed on another device, so Home now shows that one.",
    );
    await waitFor(() => expect(shownBoxes()).toEqual(["mentions"]));
    expect(useHomeLayoutStore.getState().pending).toBeNull();
    await user.click(
      within(notice.parentElement as HTMLElement).getByRole("button", { name: "OK" }),
    );
    expect(
      screen.queryByText("Your layout changed on another device, so Home now shows that one."),
    ).not.toBeInTheDocument();
  });

  it("shows a newer layout fetched from the server with the same notice", async () => {
    useHomeLayoutStore.setState({
      copy: { layout: layoutOf(box("unread", "unread")), editedAt: "2026-11-07T10:00:00.000Z" },
    });
    state.stored = {
      layout: layoutOf(box("waiting", "waiting", "full")),
      editedAt: "2026-11-07T11:00:00.000Z",
    };
    serve();
    renderHome();
    expect(
      await screen.findByText("Your layout changed on another device, so Home now shows that one."),
    ).toBeInTheDocument();
    expect(shownBoxes()).toEqual(["waiting"]);
  });

  it("resets to the default on every device after asking", async () => {
    state.stored = {
      layout: layoutOf(box("unread", "unread")),
      editedAt: "2026-11-07T10:00:00.000Z",
    };
    serve();
    const user = userEvent.setup();
    renderHome();
    await waitFor(() => expect(shownBoxes()).toEqual(["unread"]));
    await startEditing(user);
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset Home to the default?" });
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(callsTo(requestMock, "mutation ResetHomeLayout")).toHaveLength(1);
    expect(shownBoxes()).toEqual(["waiting", "mentions", "unread"]);
    expect(useHomeLayoutStore.getState().copy).toBeNull();
  });

  it("offers Add a box as a sheet in a narrow window", async () => {
    state.stored = {
      layout: layoutOf(box("waiting", "waiting")),
      editedAt: "2026-11-07T10:00:00.000Z",
    };
    useShellStore.setState({ shellWidth: "narrow" });
    serve();
    const user = userEvent.setup();
    renderHome();
    await waitFor(() => expect(shownBoxes()).toEqual(["waiting"]));
    await startEditing(user);
    expect(screen.queryByRole("complementary", { name: "Add a box" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a box" }));
    const sheet = await screen.findByRole("dialog", { name: "Add a box" });
    await user.click(within(sheet).getByRole("button", { name: "Add Unread" }));
    expect(screen.queryByRole("dialog", { name: "Add a box" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reorder Unread" })).toHaveFocus();
    // Each box keeps every control in a narrow window too.
    for (const name of [
      "Reorder Unread",
      "Make Unread full width",
      "More for Unread",
      "Remove Unread",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
