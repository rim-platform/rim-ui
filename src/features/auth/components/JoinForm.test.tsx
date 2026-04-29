/**
 * Tests for `JoinForm` — amendment 2026-04-28b field additions + BOOTSTRAP variant.
 *
 * Covers the four new assertions from spec §13b:
 * (a) Malformed email rejected client-side, inline error before submit.
 * (b) SERVER EMAIL_TAKEN error renders inline next to email field.
 * (c) displayName trimming — leading/trailing whitespace stripped before send.
 * (d) displayName empty after trim → omitted from request payload entirely.
 *
 * Also covers the BOOTSTRAP token variant (added 2026-04-28c):
 * (e) BOOTSTRAP variant routes via `bootstrapToken`, NOT `instanceInviteToken`.
 * (f) INSTANCE variant still routes via `instanceInviteToken` (regression guard).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockSignupMutate = vi.fn();

vi.mock("../api/useSignupWithInviteMutation", () => ({
  useSignupWithInviteMutation: () => ({
    mutate: mockSignupMutate,
    isPending: false,
    error: null,
  }),
}));

import { JoinForm } from "./JoinForm";
import { InviteTokenType } from "../types";

/** Renders `JoinForm` inside a router so any internal Links don't break. */
function renderWorkspaceJoinForm(onSuccess = vi.fn()) {
  return render(
    <MemoryRouter>
      <JoinForm
        variant={InviteTokenType.WORKSPACE}
        token="tok-abc"
        workspaceName="Acme Corp"
        onSuccess={onSuccess}
      />
    </MemoryRouter>,
  );
}

/** Renders `JoinForm` with an INSTANCE token variant. */
function renderInstanceJoinForm(onSuccess = vi.fn()) {
  return render(
    <MemoryRouter>
      <JoinForm
        variant={InviteTokenType.INSTANCE}
        token="instance-tok-123"
        onSuccess={onSuccess}
      />
    </MemoryRouter>,
  );
}

/** Renders `JoinForm` with a BOOTSTRAP token variant. */
function renderBootstrapJoinForm(onSuccess = vi.fn()) {
  return render(
    <MemoryRouter>
      <JoinForm
        variant={InviteTokenType.BOOTSTRAP}
        token="bootstrap-tok-456"
        onSuccess={onSuccess}
      />
    </MemoryRouter>,
  );
}

/**
 * Helper: fill in the minimum valid fields so a submit attempt can reach the
 * email-validation gate (username + password thresholds satisfied).
 */
async function fillValidBase(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("yourname"), "testuser");
  await user.type(screen.getByPlaceholderText("password"), "password123");
}

describe("JoinForm — amendment 2026-04-28b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── (a) Malformed email rejected client-side ──────────────────────────────

  it("(a) rejects malformed email client-side and surfaces inline error before submit", async () => {
    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    // noValidate must be present so the React-side EMAIL_REGEX gate is the
    // sole validator; without it browser native validation would bypass handleSubmit.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(document.querySelector("form")!.noValidate).toBe(true);

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "not-an-email");
    await user.click(screen.getByText("Create account"));

    // Mutation must NOT be called — client-side gate fires first.
    expect(mockSignupMutate).not.toHaveBeenCalled();

    // Inline error renders next to the email field.
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
  });

  it("(a) also rejects an email missing the TLD (e.g. user@host)", async () => {
    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "user@host");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
  });

  // ── (b) EMAIL_TAKEN from server renders inline ───────────────────────────

  it("(b) surfaces server EMAIL_TAKEN error inline next to the email field", async () => {
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => {
        opts.onError({
          response: {
            errors: [{ extensions: { code: "EMAIL_TAKEN" } }],
          },
        });
      },
    );

    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "taken@example.com");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    // Locked copy from spec §13b §H.
    expect(
      screen.getByText("This email is already in use. Try logging in instead."),
    ).toBeInTheDocument();
  });

  // ── (c) displayName trimming ─────────────────────────────────────────────

  it("(c) trims leading and trailing whitespace from displayName before sending", async () => {
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    // Type a display name with surrounding whitespace.
    await user.type(screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!, "  Alice  ");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();
    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Alice" }),
      expect.any(Object),
    );
  });

  // ── (d) Empty displayName after trim → omitted from payload ──────────────

  it("(d) omits displayName from the payload when left blank (not sent as empty string)", async () => {
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    // Leave displayName blank entirely.
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    // Key must be absent — NOT set to "" or undefined.
    expect(Object.prototype.hasOwnProperty.call(input, "displayName")).toBe(false);
  });

  it("(d) also omits displayName when the field contains only whitespace", async () => {
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    await user.type(screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!, "   ");
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(Object.prototype.hasOwnProperty.call(input, "displayName")).toBe(false);
  });
});

// ── BOOTSTRAP / INSTANCE token routing ───────────────────────────────────────

describe("JoinForm — BOOTSTRAP and INSTANCE token routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Fills in valid required fields and submits the form.
   * The mock mutation must be configured before calling this.
   */
  async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText("yourname"), "testuser");
    await user.type(screen.getByPlaceholderText("you@example.com"), "test@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
    await user.click(screen.getByText("Create account"));
  }

  it("(e) BOOTSTRAP variant routes via bootstrapToken, not instanceInviteToken", async () => {
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string | null } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: null } });
      },
    );

    const user = userEvent.setup();
    renderBootstrapJoinForm();
    await fillAndSubmit(user);

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    // Must use bootstrapToken, NOT instanceInviteToken.
    expect(input).toHaveProperty("bootstrapToken", "bootstrap-tok-456");
    expect(Object.prototype.hasOwnProperty.call(input, "instanceInviteToken")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(input, "workspaceInviteToken")).toBe(false);
  });

  it("(e) BOOTSTRAP variant shows 'Create your RIM account' header copy (same as INSTANCE)", () => {
    renderBootstrapJoinForm();
    expect(screen.getByText("Create your RIM account")).toBeInTheDocument();
  });

  it("(f) INSTANCE variant routes via instanceInviteToken, not bootstrapToken", async () => {
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string | null } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u2", serverId: null } });
      },
    );

    const user = userEvent.setup();
    renderInstanceJoinForm();
    await fillAndSubmit(user);

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    // Must use instanceInviteToken, NOT bootstrapToken.
    expect(input).toHaveProperty("instanceInviteToken", "instance-tok-123");
    expect(Object.prototype.hasOwnProperty.call(input, "bootstrapToken")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(input, "workspaceInviteToken")).toBe(false);
  });
});

// ── Hawkeye SF2 — displayName 1–80 character guard ───────────────────────────

describe("JoinForm — Hawkeye SF2: displayName length guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Fills in all required fields (username, email, password) with valid values
   * so submit can reach the displayName validation gate.
   */
  async function fillValidRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText("yourname"), "testuser");
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    await user.type(screen.getByPlaceholderText("password"), "password123");
  }

  it("rejects a displayName longer than 80 characters client-side — mutation not called", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JoinForm
          variant={InviteTokenType.WORKSPACE}
          token="tok-abc"
          workspaceName="Acme Corp"
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    await fillValidRequiredFields(user);

    const eightyOneChars = "a".repeat(81);
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      eightyOneChars,
    );
    await user.click(screen.getByText("Create account"));

    // Client-side guard fires — no server round-trip.
    expect(mockSignupMutate).not.toHaveBeenCalled();

    // Locked copy from spec (Hawkeye SF2).
    expect(
      screen.getByText("Display name must be at most 80 characters."),
    ).toBeInTheDocument();
  });

  it("accepts a displayName of exactly 80 characters — mutation is called", async () => {
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JoinForm
          variant={InviteTokenType.WORKSPACE}
          token="tok-abc"
          workspaceName="Acme Corp"
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    await fillValidRequiredFields(user);

    const eightyChars = "a".repeat(80);
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      eightyChars,
    );
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();
    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: eightyChars }),
      expect.any(Object),
    );
  });

  it("accepts displayName that is over 80 chars before trimming but at most 80 after trim", async () => {
    // e.g. 79 "a" chars + 2 spaces on each side = 83 total chars, but trimmed = 79 (valid)
    mockSignupMutate.mockImplementation(
      (input: unknown, opts: { onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void }) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <JoinForm
          variant={InviteTokenType.WORKSPACE}
          token="tok-abc"
          workspaceName="Acme Corp"
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    await fillValidRequiredFields(user);

    // 79 meaningful chars + surrounding spaces (trimmed = 79, within limit)
    const valueWithPadding = "  " + "a".repeat(79) + "  ";
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      valueWithPadding,
    );
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();
    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "a".repeat(79) }),
      expect.any(Object),
    );
  });
});
