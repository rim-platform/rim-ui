/**
 * Tests for `JoinForm`: field validation and token routing.
 *
 * Covers the email and display-name fields:
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
 *
 * And the server's minimum age, abuse contact and account cap.
 *
 * And invite links on an open server, which takes no token at signup: the signup sends none and
 * a workspace invite is joined once the account exists; invite-only and pow servers still get
 * the token.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import {
  fakeServerInfo,
  renderWithServerInfo,
  type FakeServerDetails,
} from "../../../test/serverInfo";

const mockSignupMutate = vi.fn();
/** The mutation's last error, as the hook reports it. */
const signupState = vi.hoisted(() => ({ error: null as unknown }));

vi.mock("../api/useSignupWithInviteMutation", () => ({
  useSignupWithInviteMutation: () => ({
    mutate: mockSignupMutate,
    isPending: false,
    error: signupState.error,
  }),
}));

const desktop = vi.hoisted(() => ({ value: false, probing: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    deviceKeyStore: desktop.value ? "keyring" : desktop.probing ? "checking" : "unsupported",
    capabilities: { deviceKeys: desktop.value, identityKeys: desktop.value },
  }),
}));

// What the server answers when the page reads its info again (after a refusal over the terms):
// the rendered server's info, never whatever server runs on this machine.
const server = vi.hoisted(() => ({ details: {} as FakeServerDetails }));
const fetchServerInfo = vi.hoisted(() => vi.fn());
vi.mock("../../updater/api/serverInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../updater/api/serverInfoApi")>()),
  fetchServerInfo,
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
const mockJoinMutate = vi.fn();
vi.mock("../../workspaces/api/useJoinServer", () => ({
  useJoinServerMutation: () => ({ mutate: mockJoinMutate, isPending: false, error: null }),
}));

vi.mock("./KeySignupForm");
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

import { JoinForm } from "./JoinForm";
import { InviteTokenType, RegistrationMode } from "../types";
import { TERMS_REFUSED_MESSAGE } from "../api/useSignupTerms";
import { MINIMUM_AGE_REFUSED_MESSAGE } from "../api/useMinimumAge";
import { REGISTRATION_FULL_MESSAGE } from "../api/registrationFull";
import { SELF_HOSTING_URL } from "./RegistrationFullNotice";

// The web app, unless a test says otherwise.
beforeEach(() => {
  desktop.value = false;
  desktop.probing = false;
  server.details = {};
  fetchServerInfo.mockImplementation(async () => fakeServerInfo({}, server.details));
});

/** Renders `JoinForm` inside a router so any internal Links don't break. */
function renderWorkspaceJoinForm(onSuccess = vi.fn()) {
  return renderWithServerInfo(
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
  return renderWithServerInfo(
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

    // The exact copy for a taken email.
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

  it("(h) shows the server's message when it refuses password signups", async () => {
    const refusal = "password signup is turned off on this server; sign up with a key";
    const err = Object.assign(new Error(refusal), {
      response: { errors: [{ message: refusal, extensions: { code: "FORBIDDEN" } }] },
    });
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => opts.onError(err),
    );

    const user = userEvent.setup();
    renderInstanceJoinForm();
    await fillAndSubmit(user);

    expect(screen.getByText(refusal)).toBeInTheDocument();
  });
});

describe("JoinForm — a server that takes key signups only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderKeysRequired(details: FakeServerDetails = { signupRequiresKeys: true }) {
    return renderWithServerInfo(
      <MemoryRouter>
        <JoinForm variant={InviteTokenType.INSTANCE} token="inst-tok" onSuccess={vi.fn()} />
      </MemoryRouter>,
      details,
    );
  }

  it("offers only the key signup where this app can hold keys", () => {
    desktop.value = true;
    renderKeysRequired();

    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({
      instanceInviteToken: "inst-tok",
    });
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(screen.queryByRole("button", { name: /with a password/i })).toBeNull();
    expect(screen.queryByText(/a password account can add a key later/i)).toBeNull();
  });

  it("says this browser cannot create keys and points to the desktop app, with no form", () => {
    renderKeysRequired();

    expect(screen.getByRole("alert")).toHaveTextContent(/this server needs a key signup/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/this browser cannot create keys/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/RIM desktop app/);
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(screen.queryByTestId("key-signup")).toBeNull();
    expect(screen.queryByRole("button", { name: /create account/i })).toBeNull();
  });

  it("shows no password form while the browser is still being checked for keys", () => {
    desktop.probing = true;
    renderKeysRequired();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(screen.queryByTestId("key-signup")).toBeNull();
  });
});

// ── displayName 1–64 character guard ─────────────────────────────────────────

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

  it("rejects a displayName longer than 64 characters client-side — mutation not called", async () => {
    const user = userEvent.setup();
    renderWithServerInfo(
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

    const sixtyFiveChars = "a".repeat(65);
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      sixtyFiveChars,
    );
    await user.click(screen.getByText("Create account"));

    // Client-side guard fires — no server round-trip.
    expect(mockSignupMutate).not.toHaveBeenCalled();

    // The exact copy for a display name over the limit.
    expect(screen.getByText("Display name must be at most 64 characters.")).toBeInTheDocument();
  });

  it("accepts a displayName of exactly 64 characters — mutation is called", async () => {
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
    renderWithServerInfo(
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

    const sixtyFourChars = "a".repeat(64);
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      sixtyFourChars,
    );
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();
    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: sixtyFourChars }),
      expect.any(Object),
    );
  });

  it("accepts displayName that is over 64 chars before trimming but at most 64 after trim", async () => {
    // e.g. 63 "a" chars + 2 spaces on each side = 67 total chars, but trimmed = 63 (valid)
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
    renderWithServerInfo(
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

    // 63 meaningful chars + surrounding spaces (trimmed = 63, within limit)
    const valueWithPadding = "  " + "a".repeat(63) + "  ";
    await user.type(
      screen.getByText("Display name (optional)").closest("label")!.querySelector("input")!,
      valueWithPadding,
    );
    await user.click(screen.getByText("Create account"));

    expect(mockSignupMutate).toHaveBeenCalledOnce();
    expect(mockSignupMutate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "a".repeat(63) }),
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
    variant: InviteTokenType | "CODE",
    token: string | null,
    onSuccess = vi.fn(),
  ) {
    return renderWithServerInfo(
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

  it("is the default on the desktop, with the password form behind a secondary link", () => {
    renderVariant(InviteTokenType.INSTANCE, "instance-tok-123");
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(
      screen.getByRole("button", { name: /create account with a password/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/a password account can add a key later/i)).toBeInTheDocument();
    expect(screen.queryByText("OR")).toBeNull();
  });

  it.each([
    [InviteTokenType.WORKSPACE, "ws-tok", { workspaceInviteToken: "ws-tok" }],
    [InviteTokenType.INSTANCE, "inst-tok", { instanceInviteToken: "inst-tok" }],
    ["CODE" as const, null, {}],
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
    renderWithServerInfo(
      <MemoryRouter>
        <JoinForm
          variant="CODE"
          token={null}
          registrationMode={RegistrationMode.POW}
          keyOnly
          onSuccess={vi.fn()}
        />
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

describe("JoinForm — instance notice and terms of service", () => {
  const TERMS = "https://acme.example/terms";

  beforeEach(() => {
    vi.clearAllMocks();
    signupState.error = null;
  });

  function renderWithServer(details: FakeServerDetails) {
    server.details = details;
    return renderWithServerInfo(
      <MemoryRouter>
        <JoinForm
          variant={InviteTokenType.WORKSPACE}
          token="tok-abc"
          workspaceName="Acme Corp"
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
      details,
    );
  }

  async function fillValid(user: ReturnType<typeof userEvent.setup>) {
    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "ada@example.com");
  }

  const submitButton = () => screen.getByRole("button", { name: "Create account" });
  const termsBox = () => screen.getByRole("checkbox", { name: "I accept the terms of use" });

  it("shows the server's notice at the top, and none without one", () => {
    const { unmount } = renderWithServer({ instanceNotice: "Run by Acme." });
    expect(screen.getByRole("note", { name: "Notice from this server" })).toHaveTextContent(
      "Run by Acme.",
    );
    unmount();

    renderWithServer({ instanceNotice: null });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("links the terms, opening them in a new tab on the web", () => {
    renderWithServer({ termsUrl: TERMS });
    const link = screen.getByRole("link", { name: TERMS });
    expect(link).toHaveAttribute("href", TERMS);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens the terms in the system browser on the desktop", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    try {
      const user = userEvent.setup();
      renderWithServer({ termsUrl: TERMS });
      await user.click(screen.getByRole("link", { name: TERMS }));
      await waitFor(() => expect(openUrl).toHaveBeenCalledWith(TERMS));
    } finally {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it("keeps Create account disabled until the terms are accepted, then sends their URL", async () => {
    const user = userEvent.setup();
    renderWithServer({ termsUrl: TERMS });
    await fillValid(user);

    expect(submitButton()).toBeDisabled();
    await user.click(termsBox());
    expect(submitButton()).toBeEnabled();
    await user.click(submitButton());

    expect(mockSignupMutate).toHaveBeenCalledOnce();
    expect(mockSignupMutate.mock.calls[0][0]).toMatchObject({ acceptedTermsUrl: TERMS });
  });

  it("shows a refusal over the terms at the checkbox and unticks it", async () => {
    const refusal = {
      response: {
        errors: [
          {
            message:
              "the terms of service must be accepted: send the server's terms URL as the accepted terms",
            extensions: { code: "VALIDATION" },
          },
        ],
      },
    };
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => {
        signupState.error = refusal;
        opts.onError(refusal);
      },
    );
    const user = userEvent.setup();
    renderWithServer({ termsUrl: TERMS });
    await fillValid(user);
    await user.click(termsBox());
    await user.click(submitButton());

    expect(screen.getByRole("alert")).toHaveTextContent(TERMS_REFUSED_MESSAGE);
    expect(termsBox()).not.toBeChecked();
    expect(termsBox()).toHaveAccessibleDescription(TERMS_REFUSED_MESSAGE);
    expect(submitButton()).toBeDisabled();
    // The page reads the server's terms again.
    await waitFor(() => expect(fetchServerInfo).toHaveBeenCalledOnce());

    await user.click(termsBox());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/terms of service must be accepted/)).not.toBeInTheDocument();
  });

  it("signs up as before on a server without terms or too old to say", async () => {
    for (const details of [{ termsUrl: null }, {}]) {
      const user = userEvent.setup();
      const { unmount } = renderWithServer(details);
      await fillValid(user);

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      await user.click(submitButton());
      expect(mockSignupMutate).toHaveBeenCalledOnce();
      expect(mockSignupMutate.mock.calls[0][0]).not.toHaveProperty("acceptedTermsUrl");
      mockSignupMutate.mockClear();
      unmount();
    }
  });
});

describe("JoinForm — minimum age, abuse contact and a full server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signupState.error = null;
  });

  function renderWithServer(details: FakeServerDetails) {
    server.details = details;
    return renderWithServerInfo(
      <MemoryRouter>
        <JoinForm variant={InviteTokenType.INSTANCE} token="tok" onSuccess={vi.fn()} />
      </MemoryRouter>,
      details,
    );
  }

  async function fillValid(user: ReturnType<typeof userEvent.setup>) {
    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "ada@example.com");
  }

  const submitButton = () => screen.getByRole("button", { name: "Create account" });
  const ageBox = () => screen.getByRole("checkbox", { name: "I am at least 16" });

  it("asks for the minimum age beside the terms, then sends it back", async () => {
    const terms = "https://acme.example/api/terms?v=Zx9-a_b";
    const user = userEvent.setup();
    renderWithServer({ termsUrl: terms, minimumAge: 16 });
    await fillValid(user);
    // Terms the server serves itself are linked with their version, and sent back unchanged.
    expect(screen.getByRole("link", { name: terms })).toHaveAttribute("href", terms);
    await user.click(screen.getByRole("checkbox", { name: "I accept the terms of use" }));

    expect(submitButton()).toBeDisabled();
    await user.click(ageBox());
    await user.click(submitButton());

    expect(mockSignupMutate.mock.calls[0][0]).toMatchObject({
      acceptedTermsUrl: terms,
      confirmedMinimumAge: 16,
    });
  });

  it("shows a refusal over the minimum age at the checkbox, unticks it and rereads the server", async () => {
    const refusal = {
      response: {
        errors: [
          {
            message:
              "the minimum age must be confirmed: send the server's minimum age as the confirmed minimum age once the person confirms reaching it",
            extensions: { code: "VALIDATION" },
          },
        ],
      },
    };
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => {
        signupState.error = refusal;
        opts.onError(refusal);
      },
    );
    const user = userEvent.setup();
    renderWithServer({ minimumAge: 16 });
    await fillValid(user);
    await user.click(ageBox());
    await user.click(submitButton());

    expect(screen.getByRole("alert")).toHaveTextContent(MINIMUM_AGE_REFUSED_MESSAGE);
    expect(ageBox()).not.toBeChecked();
    expect(ageBox()).toHaveAccessibleDescription(MINIMUM_AGE_REFUSED_MESSAGE);
    expect(screen.queryByText(/minimum age must be confirmed/)).not.toBeInTheDocument();
    await waitFor(() => expect(fetchServerInfo).toHaveBeenCalledOnce());
  });

  it("asks for no age and sends none on a server without one", async () => {
    const user = userEvent.setup();
    renderWithServer({ minimumAge: null });
    await fillValid(user);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(submitButton());
    expect(mockSignupMutate.mock.calls[0][0]).not.toHaveProperty("confirmedMinimumAge");
  });

  it("shows the abuse contact: an email address as mailto, an https URL as itself", () => {
    const { unmount } = renderWithServer({ abuseContact: "abuse@acme.example" });
    expect(screen.getByRole("link", { name: "abuse@acme.example" })).toHaveAttribute(
      "href",
      "mailto:abuse@acme.example",
    );
    unmount();

    renderWithServer({ abuseContact: "https://acme.example/report" });
    expect(screen.getByRole("link", { name: "https://acme.example/report" })).toHaveAttribute(
      "href",
      "https://acme.example/report",
    );
  });

  it("says the server is full instead of offering a signup", () => {
    renderWithServer({ registrationFull: true });
    expect(screen.getByRole("status")).toHaveTextContent("This server is full");
    expect(screen.getByRole("link", { name: "How to run a server" })).toHaveAttribute(
      "href",
      SELF_HOSTING_URL,
    );
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("says the server is full when it refuses the signup as full", async () => {
    const refusal = {
      response: {
        errors: [{ message: "this server is full", extensions: { code: "REGISTRATION_FULL" } }],
      },
    };
    mockSignupMutate.mockImplementation(
      (_input: unknown, opts: { onError: (err: unknown) => void }) => {
        signupState.error = refusal;
        opts.onError(refusal);
      },
    );
    const user = userEvent.setup();
    renderWithServer({ registrationFull: false });
    await fillValid(user);
    await user.click(submitButton());
    expect(screen.getByText(REGISTRATION_FULL_MESSAGE)).toBeInTheDocument();
  });
});

describe("JoinForm — invite links by registration mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The server creates the account; a workspace invite token also joins its workspace.
    mockSignupMutate.mockImplementation(
      (input: { workspaceInviteToken?: string }, opts: { onSuccess: (data: unknown) => void }) =>
        opts.onSuccess({
          signupWithInvite: {
            userId: "user-new",
            serverId: input.workspaceInviteToken ? "ws-acme" : null,
          },
        }),
    );
    mockJoinMutate.mockImplementation(
      (_token: string, opts: { onSuccess: (data: unknown) => void }) =>
        opts.onSuccess({ joinServerByInvite: { serverId: "ws-acme" } }),
    );
  });

  function renderLink(
    variant: InviteTokenType,
    token: string,
    registrationMode: RegistrationMode,
    onSuccess = vi.fn(),
  ) {
    renderWithServerInfo(
      <MemoryRouter>
        <JoinForm
          variant={variant}
          token={token}
          workspaceName={variant === InviteTokenType.WORKSPACE ? "Acme" : undefined}
          workspaceId={variant === InviteTokenType.WORKSPACE ? "ws-acme" : undefined}
          registrationMode={registrationMode}
          onSuccess={onSuccess}
        />
      </MemoryRouter>,
    );
    return onSuccess;
  }

  async function signUp(user: ReturnType<typeof userEvent.setup>) {
    await fillValidBase(user);
    await user.type(screen.getByPlaceholderText("you@example.com"), "newbie@example.com");
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  function signupInput(): Record<string, unknown> {
    return mockSignupMutate.mock.calls[0][0] as Record<string, unknown>;
  }

  it("signs up from a workspace link on an open server with no token, then joins the workspace", async () => {
    const user = userEvent.setup();
    const onSuccess = renderLink(InviteTokenType.WORKSPACE, "ws-tok", RegistrationMode.OPEN);

    await signUp(user);

    expect(signupInput()).not.toHaveProperty("workspaceInviteToken");
    expect(signupInput()).not.toHaveProperty("instanceInviteToken");
    expect(mockJoinMutate).toHaveBeenCalledWith("ws-tok", expect.anything());
    expect(onSuccess).toHaveBeenCalledWith("user-new", "ws-acme");
  });

  it("signs up from an instance link on an open server with no token, and joins nothing", async () => {
    const user = userEvent.setup();
    const onSuccess = renderLink(InviteTokenType.INSTANCE, "inst-tok", RegistrationMode.OPEN);

    await signUp(user);

    expect(signupInput()).not.toHaveProperty("instanceInviteToken");
    expect(signupInput()).not.toHaveProperty("workspaceInviteToken");
    expect(mockJoinMutate).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("user-new", null);
  });

  it("says the account is ready when the open server's join fails, and goes on without it", async () => {
    const user = userEvent.setup();
    mockJoinMutate.mockImplementation((_token: string, opts: { onError: (err: unknown) => void }) =>
      opts.onError({
        response: {
          errors: [{ message: "permission denied", extensions: { code: "FORBIDDEN" } }],
        },
      }),
    );
    const onSuccess = renderLink(InviteTokenType.WORKSPACE, "ws-tok", RegistrationMode.OPEN);

    await signUp(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your account is ready");
    expect(alert).toHaveTextContent("It could not join Acme: permission denied");
    expect(onSuccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSuccess).toHaveBeenCalledWith("user-new", null);
  });

  it("hands the key form no token on an open server, and joins the workspace after it", async () => {
    desktop.value = true;
    const user = userEvent.setup();
    const onSuccess = renderLink(InviteTokenType.WORKSPACE, "ws-tok", RegistrationMode.OPEN);

    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({});
    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(mockJoinMutate).toHaveBeenCalledWith("ws-tok", expect.anything());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", "ws-acme"));
  });

  it.each([
    [RegistrationMode.INVITE_ONLY, InviteTokenType.WORKSPACE, "ws-tok", "workspaceInviteToken"],
    [RegistrationMode.INVITE_ONLY, InviteTokenType.INSTANCE, "inst-tok", "instanceInviteToken"],
    [RegistrationMode.POW, InviteTokenType.WORKSPACE, "ws-tok", "workspaceInviteToken"],
    [RegistrationMode.POW, InviteTokenType.INSTANCE, "inst-tok", "instanceInviteToken"],
  ])("still sends the link's token on a %s server (%s)", async (mode, variant, token, field) => {
    const user = userEvent.setup();
    renderLink(variant, token, mode);

    await signUp(user);

    expect(signupInput()).toMatchObject({ [field]: token });
    expect(mockJoinMutate).not.toHaveBeenCalled();
  });
});
