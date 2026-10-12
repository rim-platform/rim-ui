/**
 * Tests for `JoinForm` — amendment 2026-04-28b field additions + token routing.
 *
 * Covers the four new assertions from spec §13b:
 * (a) Malformed email rejected client-side, inline error before submit.
 * (b) SERVER EMAIL_TAKEN error renders inline next to email field.
 * (c) displayName trimming — leading/trailing whitespace stripped before send.
 * (d) displayName empty after trim → omitted from request payload entirely.
 *
 * Also covers the INSTANCE token variant:
 * (e) shows "Create your RIM account" header copy.
 * (f) routes via `instanceInviteToken`.
 * (g) shows the server's refusal when an email-bound invite turns the address away.
 *
 * And the desktop's "Create account with a key", which hands the page's token to
 * `KeySignupForm` (tested on its own).
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

const desktop = vi.hoisted(() => ({ value: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value } }),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { JoinForm } from "./JoinForm";
import { InviteTokenType } from "../types";

// The web app, unless a test says otherwise.
beforeEach(() => {
  desktop.value = false;
});

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
      <JoinForm variant={InviteTokenType.INSTANCE} token="instance-tok-123" onSuccess={onSuccess} />
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
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void;
        },
      ) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    // Type a display name with surrounding whitespace.
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      "  Alice  ",
    );
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
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void;
        },
      ) => {
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
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void;
        },
      ) => {
        opts.onSuccess({ signupWithInvite: { userId: "u1", serverId: "s1" } });
      },
    );

    const user = userEvent.setup();
    renderWorkspaceJoinForm();

    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "alice@example.com");
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      "   ",
    );
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(Object.prototype.hasOwnProperty.call(input, "displayName")).toBe(false);
  });
});

// ── INSTANCE token routing ───────────────────────────────────────────────────

describe("JoinForm — INSTANCE token routing", () => {
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

  it("(e) INSTANCE variant shows 'Create your RIM account' header copy", () => {
    renderInstanceJoinForm();
    expect(screen.getByText("Create your RIM account")).toBeInTheDocument();
  });

  it("(f) INSTANCE variant routes via instanceInviteToken", async () => {
    mockSignupMutate.mockImplementation(
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string | null } }) => void;
        },
      ) => {
        opts.onSuccess({ signupWithInvite: { userId: "u2", serverId: null } });
      },
    );

    const user = userEvent.setup();
    renderInstanceJoinForm();
    await fillAndSubmit(user);

    expect(mockSignupMutate).toHaveBeenCalledOnce();

    const [input] = mockSignupMutate.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(input).toHaveProperty("instanceInviteToken", "instance-tok-123");
    expect(Object.prototype.hasOwnProperty.call(input, "workspaceInviteToken")).toBe(false);
  });

  it("(g) shows the server's message when an email-bound invite refuses the address", async () => {
    const refusal = "this invite admits only the email address it was issued for";
    // A graphql-request ClientError: its own message embeds the whole response.
    const err = Object.assign(new Error(`${refusal}: {"response":{"errors":[]}}`), {
      response: { errors: [{ message: refusal, extensions: { code: "VALIDATION" } }] },
    });
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => opts.onError(err),
    );

    const user = userEvent.setup();
    renderInstanceJoinForm();
    await fillAndSubmit(user);

    expect(screen.getByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText(/"response"/)).toBeNull();
  });
});

// ── displayName 1–80 character guard ─────────────────────────────────────────

describe("JoinForm — displayName length guard", () => {
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

    // Locked copy from spec.
    expect(screen.getByText("Display name must be at most 80 characters.")).toBeInTheDocument();
  });

  it("accepts a displayName of exactly 80 characters — mutation is called", async () => {
    mockSignupMutate.mockImplementation(
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void;
        },
      ) => {
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
      (
        input: unknown,
        opts: {
          onSuccess: (d: { signupWithInvite: { userId: string; serverId: string } }) => void;
        },
      ) => {
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

describe("JoinForm — create account with a key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktop.value = true;
  });

  function renderVariant(
    variant: InviteTokenType | "OPEN",
    token: string | null,
    onSuccess = vi.fn(),
  ) {
    return render(
      <MemoryRouter>
        <JoinForm variant={variant} token={token} onSuccess={onSuccess} />
      </MemoryRouter>,
    );
  }

  it("is not offered in the web app", () => {
    desktop.value = false;
    renderVariant(InviteTokenType.INSTANCE, "instance-tok-123");
    expect(screen.queryByRole("button", { name: /create account with a key/i })).toBeNull();
    expect(screen.getByPlaceholderText("password")).toBeInTheDocument();
  });

  it("is the default on the desktop, with the password form behind the toggle", () => {
    renderVariant(InviteTokenType.INSTANCE, "instance-tok-123");
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(
      screen.getByRole("button", { name: /create account with a password/i }),
    ).toBeInTheDocument();
  });

  it.each([
    [InviteTokenType.WORKSPACE, "ws-tok", { workspaceInviteToken: "ws-tok" }],
    [InviteTokenType.INSTANCE, "inst-tok", { instanceInviteToken: "inst-tok" }],
    ["OPEN" as const, null, {}],
  ])("%s: hands the page's token to the key form", (variant, token, expected) => {
    renderVariant(variant, token);

    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual(expected);
  });

  it("calls the page's success path when the key signup succeeds", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderVariant(InviteTokenType.WORKSPACE, "ws-tok", onSuccess);

    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(onSuccess).toHaveBeenCalledWith("user-key", "server-key");
    expect(mockSignupMutate).not.toHaveBeenCalled();
  });

  it("keeps the key form while its signup is busy", async () => {
    const user = userEvent.setup();
    renderVariant(InviteTokenType.INSTANCE, "instance-tok-123");

    await user.click(screen.getByRole("button", { name: /start key signup/i }));

    expect(screen.getByRole("button", { name: /create account with a password/i })).toBeDisabled();
  });

  it("offers only the key, with no token, on a relay that takes key signups with a proof-of-work", () => {
    render(
      <MemoryRouter>
        <JoinForm variant="OPEN" token={null} keyOnly onSuccess={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(screen.queryByRole("button", { name: /create account with a password/i })).toBeNull();
  });

  it("switches to the password form and back", async () => {
    const user = userEvent.setup();
    renderVariant(InviteTokenType.INSTANCE, "instance-tok-123");

    await user.click(screen.getByRole("button", { name: /create account with a password/i }));

    expect(screen.queryByTestId("key-signup")).toBeNull();
    expect(screen.getByPlaceholderText("password")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create account with a key/i }));

    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
  });
});
