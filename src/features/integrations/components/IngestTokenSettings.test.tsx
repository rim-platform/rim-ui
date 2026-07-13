import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";

import { useToastStore } from "../../../shared/toast";

vi.mock("../api/useIngestTokens", () => ({
  useIngestTokens: vi.fn(),
  useCreateIngestToken: vi.fn(),
  useRevokeIngestToken: vi.fn(),
}));

vi.mock("../../conversations/api/useChannels", () => ({
  useChannels: vi.fn(),
}));

vi.mock("../../../core/graphql/config", () => ({
  getApiOrigin: () => "http://localhost:8080",
}));

vi.mock("../../workspaces/api/useMyServerRole", () => ({
  useIsOwner: vi.fn(),
}));

import {
  useIngestTokens,
  useCreateIngestToken,
  useRevokeIngestToken,
} from "../api/useIngestTokens";
import { useChannels } from "../../conversations/api/useChannels";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { IngestTokenSettings } from "./IngestTokenSettings";

const activeToken = {
  id: "tok-1",
  serverId: "ws-1",
  conversationId: "conv-1",
  createdBy: "u1",
  label: "Prod Alertmanager",
  severityDefault: "SEV_2",
  createdAt: "2026-07-01T00:00:00Z",
  revokedAt: null,
  lastUsedAt: "2026-07-05T00:00:00Z",
};

const revokedToken = {
  ...activeToken,
  id: "tok-2",
  label: "Old token",
  revokedAt: "2026-07-06T00:00:00Z",
};

function mockHooks({
  tokens = [],
  createMutate = vi.fn(),
  createPending = false,
  createError = null as unknown,
  createReset = vi.fn(),
  revokeMutate = vi.fn(),
  revokePending = false,
  isOwner = true,
}: {
  tokens?: unknown[];
  createMutate?: ReturnType<typeof vi.fn>;
  createPending?: boolean;
  createError?: unknown;
  createReset?: ReturnType<typeof vi.fn>;
  revokeMutate?: ReturnType<typeof vi.fn>;
  revokePending?: boolean;
  isOwner?: boolean;
} = {}) {
  vi.mocked(useIsOwner).mockReturnValue(isOwner);
  vi.mocked(useIngestTokens).mockReturnValue({
    data: tokens,
    isPending: false,
    isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query return type
  } as any);
  vi.mocked(useChannels).mockReturnValue({
    data: { items: [{ id: "conv-1", title: "general" }] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query return type
  } as any);
  vi.mocked(useCreateIngestToken).mockReturnValue({
    mutate: createMutate,
    isPending: createPending,
    error: createError,
    reset: createReset,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query mutation result
  } as any);
  vi.mocked(useRevokeIngestToken).mockReturnValue({
    mutate: revokeMutate,
    isPending: revokePending,
    error: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query mutation result
  } as any);
}

/** jsdom has no Clipboard API; stub it so copy-button handlers are testable. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe("IngestTokenSettings", () => {
  beforeEach(() => {
    vi.mocked(useIngestTokens).mockReset();
    vi.mocked(useCreateIngestToken).mockReset();
    vi.mocked(useRevokeIngestToken).mockReset();
    vi.mocked(useChannels).mockReset();
    vi.mocked(useIsOwner).mockReset();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the token list with label, channel, and revoked state", () => {
    mockHooks({ tokens: [activeToken, revokedToken] });
    render(<IngestTokenSettings serverId="ws-1" />);

    expect(screen.getByText("Prod Alertmanager")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByText("# general")).toHaveLength(2);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("does not show a Revoke button for an already-revoked token", () => {
    mockHooks({ tokens: [revokedToken] });
    render(<IngestTokenSettings serverId="ws-1" />);
    expect(screen.queryByRole("button", { name: /revoke old token/i })).not.toBeInTheDocument();
  });

  it("submits the create form and shows the raw token exactly once, with endpoint URLs from getApiOrigin()", () => {
    const createMutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ rawToken: "rim_ingest_abc123", token: activeToken });
    });
    mockHooks({ createMutate });
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/production alertmanager/i), {
      target: { value: "My monitor" },
    });
    fireEvent.change(screen.getByDisplayValue("Select channel…"), {
      target: { value: "conv-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    expect(createMutate).toHaveBeenCalledWith(
      { serverId: "ws-1", conversationId: "conv-1", label: "My monitor" },
      expect.anything(),
    );
    expect(screen.getByText("rim_ingest_abc123")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:8080/api/hooks/alerts/generic")).toBeInTheDocument();
    expect(
      screen.getByText("http://localhost:8080/api/hooks/alerts/alertmanager"),
    ).toBeInTheDocument();
    expect(screen.getByText("http://localhost:8080/api/hooks/alerts/grafana")).toBeInTheDocument();
  });

  it("includes severityDefault only when one is selected", () => {
    const createMutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ rawToken: "tok", token: activeToken });
    });
    mockHooks({ createMutate });
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/production alertmanager/i), {
      target: { value: "My monitor" },
    });
    fireEvent.change(screen.getByDisplayValue("Select channel…"), {
      target: { value: "conv-1" },
    });
    fireEvent.change(screen.getByDisplayValue("No default"), {
      target: { value: "SEV_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    expect(createMutate).toHaveBeenCalledWith(
      { serverId: "ws-1", conversationId: "conv-1", label: "My monitor", severityDefault: "SEV_1" },
      expect.anything(),
    );
  });

  it("revoke flow: clicking Revoke opens a confirm dialog, and confirming calls the mutation", () => {
    const revokeMutate = vi.fn((_vars, options) => {
      options?.onSuccess?.();
    });
    mockHooks({ tokens: [activeToken], revokeMutate });
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.click(screen.getByRole("button", { name: /revoke prod alertmanager/i }));
    expect(screen.getByText("Revoke ingest token?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revokeMutate).toHaveBeenCalledWith(
      { serverId: "ws-1", tokenId: "tok-1" },
      expect.anything(),
    );
  });

  it("cancelling the revoke dialog does not call the mutation", () => {
    const revokeMutate = vi.fn();
    mockHooks({ tokens: [activeToken], revokeMutate });
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.click(screen.getByRole("button", { name: /revoke prod alertmanager/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Revoke ingest token?")).not.toBeInTheDocument();
    expect(revokeMutate).not.toHaveBeenCalled();
  });

  it("clicking Done resets the create mutation alongside dismissing the one-time reveal", () => {
    const createMutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ rawToken: "rim_ingest_abc123", token: activeToken });
    });
    const createReset = vi.fn();
    mockHooks({ createMutate, createReset });
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/production alertmanager/i), {
      target: { value: "My monitor" },
    });
    fireEvent.change(screen.getByDisplayValue("Select channel…"), {
      target: { value: "conv-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));
    expect(screen.getByText("rim_ingest_abc123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(createReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("rim_ingest_abc123")).not.toBeInTheDocument();
  });

  it("shows an error toast (and doesn't throw) when copying the raw token fails", async () => {
    const createMutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ rawToken: "rim_ingest_abc123", token: activeToken });
    });
    mockHooks({ createMutate });
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/production alertmanager/i), {
      target: { value: "My monitor" },
    });
    fireEvent.change(screen.getByDisplayValue("Select channel…"), {
      target: { value: "conv-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
      await Promise.resolve();
    });

    expect(useToastStore.getState().toasts[0]?.title).toBe("Couldn't copy — copy manually");
  });

  it("shows an error toast when copying an endpoint URL fails", async () => {
    const createMutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ rawToken: "tok", token: activeToken });
    });
    mockHooks({ createMutate });
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<IngestTokenSettings serverId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/production alertmanager/i), {
      target: { value: "My monitor" },
    });
    fireEvent.change(screen.getByDisplayValue("Select channel…"), {
      target: { value: "conv-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create token/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy generic endpoint" }));
      await Promise.resolve();
    });

    expect(useToastStore.getState().toasts[0]?.title).toBe("Couldn't copy — copy manually");
  });

  it("shows a forbidden-friendly message when the (owner's) query errors regardless", () => {
    vi.mocked(useIsOwner).mockReturnValue(true);
    vi.mocked(useIngestTokens).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock
    } as any);
    vi.mocked(useChannels).mockReturnValue({ data: { items: [] } } as ReturnType<
      typeof useChannels
    >);
    vi.mocked(useCreateIngestToken).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock
    } as any);
    vi.mocked(useRevokeIngestToken).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock
    } as any);

    render(<IngestTokenSettings serverId="ws-1" />);
    expect(screen.getByText(/owner-only/i)).toBeInTheDocument();
  });

  it("gates the create form and revoke buttons on isOwner (Track C1 role signal)", () => {
    mockHooks({ tokens: [activeToken], isOwner: false });
    render(<IngestTokenSettings serverId="ws-1" />);

    // The ingestTokens query isn't even issued for a non-owner.
    expect(useIngestTokens).toHaveBeenCalledWith(undefined);
    expect(screen.getByText(/ingest-token management is owner-only/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /revoke prod alertmanager/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create token/i })).not.toBeInTheDocument();
  });

  it("shows the raw createToken.error.message in dev builds", () => {
    // import.meta.env.DEV defaults to true under vitest.
    mockHooks({ createError: new Error("token limit reached") });
    render(<IngestTokenSettings serverId="ws-1" />);
    expect(screen.getByText("token limit reached")).toBeInTheDocument();
  });

  it("hides the raw createToken.error.message and shows a generic message in production builds", () => {
    vi.stubEnv("DEV", false as unknown as string);
    mockHooks({ createError: new Error("token limit reached") });
    render(<IngestTokenSettings serverId="ws-1" />);
    expect(screen.queryByText("token limit reached")).not.toBeInTheDocument();
    expect(screen.getByText("Failed to create token")).toBeInTheDocument();
  });
});
