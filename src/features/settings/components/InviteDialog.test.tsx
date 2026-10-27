import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useToastStore } from "../../../shared/toast";

vi.mock("../api/useInviteMutations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/useInviteMutations")>()),
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

  it("says this server can't send email invites, without the reason", () => {
    const mutate = vi.fn();
    mockCreateInvite({ mutate });
    renderDialog({
      email: { state: ServerFeatureState.UNAVAILABLE, reason: "SMTP is not configured" },
    });

    expect(screen.queryByLabelText(/email invite/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This server can't send email invites. Generate the link and share it yourself.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("SMTP is not configured")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    expect(mutate).toHaveBeenCalledWith({ serverId: "ws-1", role: "MEMBER" }, expect.anything());
  });

  it("uses the same message when the operator switched email off", () => {
    mockCreateInvite();
    renderDialog({ email: ServerFeatureState.DISABLED });

    expect(screen.queryByLabelText(/email invite/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This server can't send email invites. Generate the link and share it yourself.",
      ),
    ).toBeInTheDocument();
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

  it("offers 1, 7 and 30 days, defaults to 7 and leaves that default to the server", () => {
    const mutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
    });
    mockCreateInvite({ mutate });
    renderDialog();

    const select = screen.getByLabelText("Expires after");
    expect(select).toHaveValue("7");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "1 day",
      "7 days",
      "30 days",
    ]);
    expect(screen.queryByText(/never/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    expect(mutate).toHaveBeenCalledWith({ serverId: "ws-1", role: "MEMBER" }, expect.anything());
    expect(screen.getByText(/and it expires in 7 days\./)).toBeInTheDocument();
  });

  it.each([
    ["1", 1, "1 day"],
    ["30", 30, "30 days"],
  ])("sends a picked expiry of %s days", (value, days, label) => {
    const mutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
    });
    mockCreateInvite({ mutate });
    renderDialog();

    fireEvent.change(screen.getByLabelText("Expires after"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(mutate).toHaveBeenCalledWith(
      { serverId: "ws-1", role: "MEMBER", expiresInDays: days },
      expect.anything(),
    );
    expect(screen.getByText(new RegExp(`and it expires in ${label}\\.`))).toBeInTheDocument();
  });

  it("puts a server VALIDATION about the expiry on the expiry field, not the email field", () => {
    const refusal = {
      response: {
        errors: [
          {
            message: "expires_at may not be more than 30 days from now",
            extensions: { code: "VALIDATION" },
          },
        ],
      },
    };
    const mutate = vi.fn((_input, options) => options?.onError?.(refusal));
    mockCreateInvite({ mutate, error: refusal });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/email invite/i), {
      target: { value: "teammate@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Expires after"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(screen.getByText(/The server refused this expiry/)).toBeInTheDocument();
    expect(
      screen.queryByText("That doesn't look like a valid email address."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/expires_at may not be/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Expires after"), { target: { value: "7" } });
    expect(screen.queryByText(/The server refused this expiry/)).not.toBeInTheDocument();
  });

  it("shows another VALIDATION in the banner when no email was sent", () => {
    const refusal = {
      response: {
        errors: [{ message: "max_uses must be > 0", extensions: { code: "VALIDATION" } }],
      },
    };
    const mutate = vi.fn((_input, options) => options?.onError?.(refusal));
    mockCreateInvite({ mutate, error: refusal });
    renderDialog({ email: ServerFeatureState.DISABLED });

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(screen.getByText("max_uses must be > 0")).toBeInTheDocument();
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
    [3, { maxUses: 3 }, "Up to 3 people can join with it"],
    [1, { maxUses: 1 }, "One person can join with it"],
    [50, {}, "Up to 10 people can join with it"],
  ])("asks for no more uses than the instance's cap of %i", (cap, uses, text) => {
    const mutate = vi.fn();
    mockCreateInvite({ mutate });
    render(<InviteDialog open onClose={() => {}} />, {
      wrapper: withLimits({ inviteMaxUses: cap }),
    });

    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));
    expect(mutate).toHaveBeenCalledWith(
      { serverId: "ws-1", role: "MEMBER", ...uses },
      expect.anything(),
    );
  });

  it("says the same number of people after the link is generated", () => {
    const mutate = vi.fn((_input, options) => {
      options?.onSuccess?.({ createInvite: { inviteToken: "tok-1", inviteId: "inv-1" } });
    });
    mockCreateInvite({ mutate });
    render(<InviteDialog open onClose={() => {}} />, {
      wrapper: withLimits({ inviteMaxUses: 3 }),
    });

    fireEvent.click(screen.getByRole("button", { name: /generate invite link/i }));

    expect(
      screen.getByText("Up to 3 people can join with it, and it expires in", { exact: false }),
    ).toBeInTheDocument();
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
