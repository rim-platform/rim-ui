import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import { PipelineTriggerKindGql } from "../../../core/graphql/generated/schema-types";
import { useToastStore } from "../../../shared/toast";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import type { Pipeline } from "../api/usePipelines";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock("../../commands/api/useCommands", () => ({
  useCommands: () => ({
    data: [
      { id: "chat.pin", title: "Pin message", category: "chat" },
      { id: "chat.notify", title: "Notify", category: "chat" },
    ],
  }),
}));

import { PipelineSettings } from "./PipelineSettings";

// --- request routing by operation name ---

type Handler = (vars: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;

function operationName(doc: unknown): string {
  return /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1] ?? "unknown";
}

function callsTo(op: string): Record<string, unknown>[] {
  return requestMock.mock.calls
    .filter(([doc]) => operationName(doc) === op)
    .map(([, vars]) => vars as Record<string, unknown>);
}

function toastTitles(): string[] {
  return useToastStore.getState().toasts.map((t) => t.title);
}

const basePipeline: Pipeline = {
  id: "p-1",
  serverId: "ws-1",
  name: "Escalate urgent",
  description: "Pin anything urgent",
  trigger: { kind: PipelineTriggerKindGql.NEW_MESSAGE, conversationId: null },
  filter: {
    conditions: [
      { conditionType: "MessageContains", pattern: "urgent", userId: null, conversationId: null },
    ],
  },
  actions: [{ actionType: "COMMAND", commandId: "chat.pin", args: { silent: true } }],
  enabled: true,
  cooldownSecs: 60,
  createdBy: "u-1",
  schemaVersion: 1,
  lastFiredAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const disabledPipeline: Pipeline = {
  ...basePipeline,
  id: "p-2",
  name: "Welcome",
  description: null,
  trigger: { kind: PipelineTriggerKindGql.MEMBER_JOINED, conversationId: null },
  filter: null,
  actions: [
    { actionType: "COMMAND", commandId: "chat.notify", args: null },
    { actionType: "COMMAND", commandId: "chat.pin", args: null },
  ],
  enabled: false,
  cooldownSecs: null,
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((doc: unknown, vars: Record<string, unknown>) => {
    const handler = handlers[operationName(doc)];
    if (!handler) throw new Error(`unexpected operation ${operationName(doc)}`);
    return Promise.resolve(handler(vars));
  });
  handlers = { Pipelines: () => ({ pipelines: [basePipeline, disabledPipeline] }) };
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PipelineSettings list states", () => {
  it("shows a loading state while pipelines load", () => {
    handlers.Pipelines = () => new Promise(() => {});
    render(<PipelineSettings />);
    expect(screen.getByText("Loading pipelines...")).toBeInTheDocument();
  });

  it("shows the empty state when the workspace has no pipelines", async () => {
    handlers.Pipelines = () => ({ pipelines: [] });
    render(<PipelineSettings />);
    expect(await screen.findByText(/No pipelines yet/)).toBeInTheDocument();
  });

  it("shows an error instead of the empty state when loading fails", async () => {
    handlers.Pipelines = () => Promise.reject(new Error("network"));
    render(<PipelineSettings />);
    expect(await screen.findByText("Failed to load pipelines.")).toBeInTheDocument();
    expect(screen.queryByText(/No pipelines yet/)).not.toBeInTheDocument();
  });

  it("lists pipelines with status, trigger and action count", async () => {
    render(<PipelineSettings />);
    expect(await screen.findByText("Escalate urgent")).toBeInTheDocument();
    expect(screen.getByText("Pin anything urgent")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Trigger: New Message")).toBeInTheDocument();
    expect(screen.getByText("1 action")).toBeInTheDocument();

    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Trigger: Member Joined")).toBeInTheDocument();
    expect(screen.getByText("2 actions")).toBeInTheDocument();
    expect(callsTo("Pipelines")).toEqual([{ serverId: "ws-1" }]);
  });
});

describe("PipelineSettings create flow", () => {
  async function openCreate() {
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");
    fireEvent.click(screen.getByText("New Pipeline"));
    expect(screen.getByText("Create Pipeline")).toBeInTheDocument();
  }

  it("disables Save until a name is entered", async () => {
    await openCreate();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("My pipeline"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("refuses to save without an action command", async () => {
    await openCreate();
    fireEvent.change(screen.getByPlaceholderText("My pipeline"), { target: { value: "Ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastTitles()).toContain("Add at least one action with a command"));
    expect(callsTo("CreatePipeline")).toHaveLength(0);
  });

  it("refuses to save when action args are not valid JSON", async () => {
    await openCreate();
    fireEvent.change(screen.getByPlaceholderText("My pipeline"), { target: { value: "Ping" } });
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "chat.pin" },
    });
    fireEvent.change(screen.getByPlaceholderText('{"key": "value"} (optional)'), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toastTitles()).toContain('Invalid JSON in args for action "chat.pin"'),
    );
    expect(callsTo("CreatePipeline")).toHaveLength(0);
    expect(screen.getByText("Create Pipeline")).toBeInTheDocument();
  });

  it("creates a pipeline with trigger, filter, actions and cooldown, then refreshes the list", async () => {
    handlers.CreatePipeline = () => ({ createPipeline: { ...basePipeline, id: "p-3" } });
    await openCreate();

    fireEvent.change(screen.getByPlaceholderText("My pipeline"), {
      target: { value: "  Triage  " },
    });
    fireEvent.change(screen.getByPlaceholderText("What does this pipeline do?"), {
      target: { value: "Route alerts" },
    });
    fireEvent.change(screen.getByDisplayValue("New Message"), {
      target: { value: PipelineTriggerKindGql.REACTIONS_UPDATED },
    });
    fireEvent.change(screen.getByPlaceholderText("Scope to conversation ID (optional)"), {
      target: { value: "conv-7" },
    });
    fireEvent.click(screen.getByText("Add filter"));
    // The text condition says it never matches encrypted messages.
    expect(
      screen.getByText(/^Never matches messages in end-to-end encrypted DMs and groups/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Pattern (e.g. urgent)"), {
      target: { value: "sev1" },
    });
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "chat.notify" },
    });
    fireEvent.change(screen.getByPlaceholderText('{"key": "value"} (optional)'), {
      target: { value: '{"level":2}' },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. 60"), { target: { value: "30" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Pipelines");
    expect(callsTo("CreatePipeline")).toEqual([
      {
        input: {
          serverId: "ws-1",
          name: "Triage",
          description: "Route alerts",
          trigger: { kind: PipelineTriggerKindGql.REACTIONS_UPDATED, conversationId: "conv-7" },
          filter: {
            conditions: [
              {
                conditionType: "MessageContains",
                pattern: "sev1",
                userId: undefined,
                conversationId: undefined,
              },
            ],
          },
          actions: [{ commandId: "chat.notify", args: { level: 2 } }],
          cooldownSecs: 30,
        },
      },
    ]);
    // Invalidation refetches the list.
    await waitFor(() => expect(callsTo("Pipelines").length).toBeGreaterThanOrEqual(2));
  });

  it("drops empty action rows and an invalid cooldown", async () => {
    handlers.CreatePipeline = () => ({ createPipeline: basePipeline });
    await openCreate();
    fireEvent.change(screen.getByPlaceholderText("My pipeline"), { target: { value: "Ping" } });
    fireEvent.click(screen.getByText("Add action"));
    const [first] = screen.getAllByPlaceholderText("Search commands...");
    fireEvent.change(first, { target: { value: "chat.pin" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. 60"), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(callsTo("CreatePipeline")).toHaveLength(1));
    const input = callsTo("CreatePipeline")[0].input as Record<string, unknown>;
    expect(input.actions).toEqual([{ commandId: "chat.pin", args: undefined }]);
    expect(input.cooldownSecs).toBeUndefined();
    expect(input.filter).toBeUndefined();
  });

  it("keeps the editor open and reports a server error", async () => {
    handlers.CreatePipeline = () => Promise.reject(new Error("Name already taken"));
    await openCreate();
    fireEvent.change(screen.getByPlaceholderText("My pipeline"), { target: { value: "Ping" } });
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "chat.pin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastTitles()).toContain("Name already taken"));
    expect(screen.getByText("Create Pipeline")).toBeInTheDocument();
  });

  it("returns to the list on Cancel without saving", async () => {
    await openCreate();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Escalate urgent")).toBeInTheDocument();
    expect(callsTo("CreatePipeline")).toHaveLength(0);
  });
});

describe("PipelineSettings edit, toggle and delete", () => {
  it("prefills the editor and sends an update keyed by pipeline id", async () => {
    handlers.UpdatePipeline = () => ({ updatePipeline: { ...basePipeline, name: "Escalate" } });
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");
    fireEvent.click(screen.getAllByTitle("Edit pipeline")[0]);

    expect(screen.getByText("Edit: Escalate urgent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pin anything urgent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("urgent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("chat.pin")).toBeInTheDocument();
    expect(screen.getByDisplayValue('{"silent":true}')).toBeInTheDocument();
    expect(screen.getByDisplayValue("60")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Escalate urgent"), {
      target: { value: "Escalate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Pipelines");
    expect(callsTo("UpdatePipeline")).toEqual([
      {
        input: {
          pipelineId: "p-1",
          name: "Escalate",
          description: "Pin anything urgent",
          trigger: { kind: PipelineTriggerKindGql.NEW_MESSAGE, conversationId: undefined },
          filter: {
            conditions: [
              {
                conditionType: "MessageContains",
                pattern: "urgent",
                userId: undefined,
                conversationId: undefined,
              },
            ],
          },
          actions: [{ commandId: "chat.pin", args: { silent: true } }],
          cooldownSecs: 60,
        },
      },
    ]);
    expect(callsTo("CreatePipeline")).toHaveLength(0);
  });

  it("removing a filter row sends no filter", async () => {
    handlers.UpdatePipeline = () => ({ updatePipeline: basePipeline });
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");
    fireEvent.click(screen.getAllByTitle("Edit pipeline")[0]);

    const filterRow = screen.getByDisplayValue("urgent").closest("div.flex.items-start");
    expect(filterRow).not.toBeNull();
    fireEvent.click(
      within(filterRow as HTMLElement)
        .getAllByRole("button")
        .at(-1)!,
    );
    expect(screen.getByText(/No filters/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo("UpdatePipeline")).toHaveLength(1));
    expect((callsTo("UpdatePipeline")[0].input as Record<string, unknown>).filter).toBeUndefined();
  });

  it("toggles a pipeline to the opposite state", async () => {
    handlers.TogglePipeline = (vars) => ({
      togglePipeline: { ...basePipeline, enabled: vars.enabled },
    });
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");

    fireEvent.click(screen.getByTitle("Disable pipeline"));
    await waitFor(() =>
      expect(callsTo("TogglePipeline")).toEqual([{ pipelineId: "p-1", enabled: false }]),
    );

    fireEvent.click(screen.getByTitle("Enable pipeline"));
    await waitFor(() =>
      expect(callsTo("TogglePipeline")[1]).toEqual({ pipelineId: "p-2", enabled: true }),
    );
  });

  it("deletes after confirmation and refreshes the list", async () => {
    handlers.DeletePipeline = () => ({ deletePipeline: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");

    fireEvent.click(screen.getAllByTitle("Delete pipeline")[0]);

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete pipeline "Escalate urgent"? This cannot be undone.',
    );
    await waitFor(() => expect(callsTo("DeletePipeline")).toEqual([{ pipelineId: "p-1" }]));
    await waitFor(() => expect(callsTo("Pipelines").length).toBeGreaterThanOrEqual(2));
  });

  it("does nothing when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");

    fireEvent.click(screen.getAllByTitle("Delete pipeline")[0]);
    expect(callsTo("DeletePipeline")).toHaveLength(0);
  });

  it("reports a failed delete", async () => {
    handlers.DeletePipeline = () => Promise.reject(new Error("Forbidden"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PipelineSettings />);
    await screen.findByText("Escalate urgent");

    fireEvent.click(screen.getAllByTitle("Delete pipeline")[0]);
    await waitFor(() => expect(toastTitles()).toContain("Forbidden"));
  });
});
