import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useToastStore } from "../../../shared/toast";

vi.mock("../api/useInviteMutations", () => ({
  DEFAULT_INVITE_USES: 10,
  useCreateInviteMutation: vi.fn(),
}));

import { useCreateInviteMutation } from "../api/useInviteMutations";
import { InviteDialog } from "./InviteDialog";
import { withServerInfo, type FakeFeatures } from "../../../test/serverInfo";
import { withLimits } from "../../../test/limits";
import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";

function renderDialog(features: FakeFeatures = {}) {
  return render(<InviteDialog open onClose={() => {}} />, { wrapper: withServerInfo(features) });
}

function mockCreateInvite({
  mutate = vi.fn(),
  isPending = false,
  error = null as unknown,
}: { mutate?: ReturnType<typeof vi.fn>; isPending?: boolean; error?: unknown } = {}) {
  vi.mocked(useCreateInviteMutation).mockReturnValue({
    mutate,
    isPending,
    error,
    reset: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial mock of a large TanStack Query mutation result
  } as any);
}

const DAILY_REFUSAL = {
  response: {
    errors: [
      {
        message: "this instance allows 5 invites per user per day",
        extensions: { code: "VALIDATION" },
      },
    ],
  },
};

/** jsdom has no Clipboard API; stub it so the copy-button handler is testable. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

describe("InviteDialog", () => {
  beforeEach(() => {
    vi.mocked(useCreateInviteMutation).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useToastStore.setState({ toasts: [] });
  });

  it("says email is not set up, with the reason, in place of the email field", () => {
    const mutate = vi.fn();
    mockCreateInvite({ mutate });
    renderDialog({
      email: { state: ServerFeatureState.UNAVAILABLE, reason: "SMTP is not configured" },
    });

    expect(screen.queryByLabelText(/email invite/i)).not.toBeInTheDocument();
    expect(screen.getByText("Email is not set up on this server.")).toBeInTheDocument();
    expect(screen.getByText("SMTP is not configured")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    expect(mutate).toHaveBeenCalledWith({ serverId: "ws-1", role: "MEMBER" }, expect.anything());
  });

  it("empty email: generates a link-only invite (no recipientEmail in the call)", () => {
    const mutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
    });
    mockCreateInvite({ mutate });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(mutate).toHaveBeenCalledWith({ serverId: "ws-1", role: "MEMBER" }, expect.anything());
    expect(screen.getByText(`${window.location.origin}/join/tok-1`)).toBeInTheDocument();
  });

  describe("invite link origin", () => {
    function generateLink() {
      const mutate = vi.fn((_input, options) => {
        options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
      });
      mockCreateInvite({ mutate });
      renderDialog();
      fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    }

    afterEach(() => {
      vi.unstubAllEnvs();
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it("uses the page's origin in the web app", () => {
      vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://rim.example.org/api");
      generateLink();
      expect(screen.getByText(`${window.location.origin}/join/tok-1`)).toBeInTheDocument();
    });

    it("uses the server's origin in the desktop app, not the webview's", () => {
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      vi.stubEnv("VITE_GRAPHQL_ENDPOINT", "https://rim.example.org/api");
      generateLink();
      expect(screen.getByText("https://rim.example.org/join/tok-1")).toBeInTheDocument();
    });
  });

  it("valid email: includes recipientEmail in the mutation call", () => {
    const mutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
    });
    mockCreateInvite({ mutate });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/email invite/i), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(mutate).toHaveBeenCalledWith(
      { serverId: "ws-1", role: "MEMBER", recipientEmail: "teammate@example.com" },
      expect.anything(),
    );
    expect(screen.getByText(`${window.location.origin}/join/tok-1`)).toBeInTheDocument();
  });

  it("defaults to Member and can mint a Guest invite", () => {
    const mutate = vi.fn();
    mockCreateInvite({ mutate });
    renderDialog();

    expect(screen.getByRole("radio", { name: /member/i })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /guest/i }));
    expect(screen.getByRole("radio", { name: /guest/i })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(mutate).toHaveBeenCalledWith({ serverId: "ws-1", role: "GUEST" }, expect.anything());
  });

  it("invalid email: shows an inline error and does not call the mutation", () => {
    const mutate = vi.fn();
    mockCreateInvite({ mutate });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/email invite/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears the inline email error once the field is edited again", () => {
    mockCreateInvite();
    renderDialog();

    const input = screen.getByLabelText(/email invite/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "still-typing" } });
    expect(screen.queryByText("Enter a valid email address.")).not.toBeInTheDocument();
  });

  it("surfaces a server VALIDATION error on the email field", () => {
    const mutate = vi.fn((_input, options) => {
      options?.onError?.({
        response: { errors: [{ extensions: { code: "VALIDATION" } }] },
      });
    });
    mockCreateInvite({ mutate });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/email invite/i), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(screen.getByText("That doesn't look like a valid email address.")).toBeInTheDocument();
  });

  it("shows an error toast (and doesn't throw) when copying the link fails", async () => {
    const mutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
    });
    mockCreateInvite({ mutate });
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy invite link/i }));
      await Promise.resolve();
    });

    expect(useToastStore.getState().toasts[0]?.title).toBe("Couldn't copy — copy manually");
  });

  it.each([
    [3, { maxUses: 3 }, "Each link can be used up to 3 times."],
    [1, { maxUses: 1 }, "Each link can be used once."],
    [50, {}, "Each link can be used up to 10 times."],
  ])("asks for no more uses than the instance's cap of %i", (cap, uses, text) => {
    const mutate = vi.fn();
    mockCreateInvite({ mutate });
    render(<InviteDialog open onClose={() => {}} />, {
      wrapper: withLimits({ inviteMaxUses: cap }),
    });

    expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    expect(mutate).toHaveBeenCalledWith(
      { serverId: "ws-1", role: "MEMBER", ...uses },
      expect.anything(),
    );
  });

  it("shows the daily invite cap, and that it is reached once the server refuses", () => {
    mockCreateInvite();
    const { rerender } = render(<InviteDialog open onClose={() => {}} />, {
      wrapper: withLimits({ invitesPerUserPerDay: 5 }),
    });
    expect(screen.getByTestId("limit-note")).toHaveTextContent(
      /^Up to 5 invites per user per day$/,
    );

    const mutate = vi.fn((_input, options) => options?.onError?.(DAILY_REFUSAL));
    mockCreateInvite({ mutate, error: DAILY_REFUSAL });
    rerender(<InviteDialog open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/email invite/i), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(screen.getByTestId("limit-note")).toHaveTextContent(
      "5 of 5 invites in the last 24 hours. This instance allows 5 invites per user per day.",
    );
    expect(
      screen.queryByText("That doesn't look like a valid email address."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/this instance allows 5 invites/)).not.toBeInTheDocument();
  });

  it("shows the server's message, not the raw response, for another refusal", () => {
    mockCreateInvite({
      error: {
        response: { errors: [{ message: "permission denied", extensions: { code: "FORBIDDEN" } }] },
        message: 'permission denied: {"response":{}}',
      },
    });
    renderDialog();
    expect(screen.getByText("permission denied")).toBeInTheDocument();
  });
});
