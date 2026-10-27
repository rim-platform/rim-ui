/**
 * Tests for `JoinForm`: the header of each token variant, the key signup it hands the page's
 * token to (`KeySignupForm`, tested on its own), a browser that cannot create keys, the server's
 * notice, abuse contact and account cap, and invite links on an open server, which takes no
 * token at signup: the signup sends none and a workspace invite is joined once the account
 * exists; invite-only and pow servers still get the token.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { renderWithServerInfo, type FakeServerDetails } from "../../../test/serverInfo";

const keys = vi.hoisted(() => ({ value: true, probing: false }));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    deviceKeyStore: keys.value ? "keyring" : keys.probing ? "checking" : "unsupported",
    capabilities: { deviceKeys: keys.value, identityKeys: keys.value },
  }),
}));

const mockJoinMutate = vi.fn();
vi.mock("../../workspaces/api/useJoinServer", () => ({
  useJoinServerMutation: () => ({ mutate: mockJoinMutate, isPending: false, error: null }),
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { JoinForm } from "./JoinForm";
import { InviteTokenType, RegistrationMode } from "../types";
import { NO_KEYS_HERE_MESSAGE } from "./NoKeysHere";
import { SELF_HOSTING_URL } from "./RegistrationFullNotice";

// An app that can create keys, unless a test says otherwise.
beforeEach(() => {
  vi.clearAllMocks();
  keys.value = true;
  keys.probing = false;
});

function renderVariant(
  variant: InviteTokenType | "CODE",
  token: string | null,
  onSuccess = vi.fn(),
  details: FakeServerDetails = {},
) {
  return renderWithServerInfo(
    <MemoryRouter>
      <JoinForm variant={variant} token={token} onSuccess={onSuccess} />
    </MemoryRouter>,
    details,
  );
}

const keyTokens = () => JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "");

describe("JoinForm — header", () => {
  it("INSTANCE variant shows 'Create your RIM account' header copy", () => {
    renderVariant(InviteTokenType.INSTANCE, "instance-tok-123");
    expect(screen.getByText("Create your RIM account")).toBeInTheDocument();
  });

  it("WORKSPACE variant names the workspace", () => {
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
    expect(screen.getByText("You're joining Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Create your account.")).toBeInTheDocument();
  });
});

describe("JoinForm — the key signup", () => {
  it.each([
    [InviteTokenType.WORKSPACE, "ws-tok", { workspaceInviteToken: "ws-tok" }],
    [InviteTokenType.INSTANCE, "inst-tok", { instanceInviteToken: "inst-tok" }],
    ["CODE" as const, null, {}],
  ])("%s: hands the page's token to the key form", (variant, token, expected) => {
    renderVariant(variant, token);

    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(keyTokens()).toEqual(expected);
  });

  it("offers no password signup", () => {
    renderVariant(InviteTokenType.INSTANCE, "inst-tok");

    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(screen.queryByRole("button", { name: /with a password/i })).toBeNull();
    expect(screen.queryByText(/a password account can add a key later/i)).toBeNull();
  });

  it("calls the page's success path when the key signup succeeds", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderVariant(InviteTokenType.WORKSPACE, "ws-tok", onSuccess);

    await user.click(screen.getByRole("button", { name: /finish key signup/i }));

    expect(onSuccess).toHaveBeenCalledWith("user-key", "server-key");
  });

  it("holds the invite code field while the key signup is busy", async () => {
    const user = userEvent.setup();
    renderWithServerInfo(
      <MemoryRouter>
        <JoinForm
          variant="CODE"
          token={null}
          registrationMode={RegistrationMode.INVITE_ONLY}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/invite code/i)).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /start key signup/i }));

    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(screen.getByLabelText(/invite code/i)).toBeDisabled();
  });

  it("says Account created and hides the invite code field while the kit is shown", async () => {
    const user = userEvent.setup();
    renderWithServerInfo(
      <MemoryRouter>
        <JoinForm
          variant="CODE"
          token={null}
          registrationMode={RegistrationMode.INVITE_ONLY}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Create your RIM account")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /create key account/i }));

    expect(screen.getByText("Account created")).toBeInTheDocument();
    expect(screen.queryByText("Create your RIM account")).toBeNull();
    expect(screen.queryByLabelText(/invite code/i)).toBeNull();
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
  });

  it("hands no token to the key form on a relay that takes key signups with a proof-of-work", () => {
    renderWithServerInfo(
      <MemoryRouter>
        <JoinForm
          variant="CODE"
          token={null}
          registrationMode={RegistrationMode.POW}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("key-signup")).toBeInTheDocument();
    expect(keyTokens()).toEqual({});
  });
});

describe("JoinForm — an app that cannot create keys", () => {
  it("says this browser cannot create the keys an account needs, with no form", () => {
    keys.value = false;
    renderVariant(InviteTokenType.INSTANCE, "inst-tok");

    expect(screen.getByText(NO_KEYS_HERE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).toBeNull();
    expect(screen.queryByTestId("key-signup")).toBeNull();
    expect(screen.queryByRole("button", { name: /create account/i })).toBeNull();
  });

  it("shows no form while the browser is still being checked for keys", () => {
    keys.value = false;
    keys.probing = true;
    renderVariant(InviteTokenType.INSTANCE, "inst-tok");

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText(NO_KEYS_HERE_MESSAGE)).toBeNull();
    expect(screen.queryByTestId("key-signup")).toBeNull();
  });
});

describe("JoinForm — instance notice, abuse contact and a full server", () => {
  function renderWithServer(details: FakeServerDetails) {
    return renderVariant(InviteTokenType.INSTANCE, "tok", vi.fn(), details);
  }

  it("shows the server's notice at the top, and none without one", () => {
    const { unmount } = renderWithServer({ instanceNotice: "Run by Acme." });
    expect(screen.getByRole("note", { name: "Notice from this server" })).toHaveTextContent(
      "Run by Acme.",
    );
    unmount();

    renderWithServer({ instanceNotice: null });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
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
    expect(screen.queryByTestId("key-signup")).not.toBeInTheDocument();
  });
});

describe("JoinForm — invite links by registration mode", () => {
  beforeEach(() => {
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

  const signUp = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: /finish key signup/i }));

  it("hands the key form no token on an open server, and joins the workspace after it", async () => {
    const user = userEvent.setup();
    const onSuccess = renderLink(InviteTokenType.WORKSPACE, "ws-tok", RegistrationMode.OPEN);

    expect(keyTokens()).toEqual({});
    await signUp(user);

    expect(mockJoinMutate).toHaveBeenCalledWith("ws-tok", expect.anything());
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", "ws-acme"));
  });

  it("joins the workspace as soon as the account exists, before the kit is closed", async () => {
    const user = userEvent.setup();
    const onSuccess = renderLink(InviteTokenType.WORKSPACE, "ws-tok", RegistrationMode.OPEN);

    await user.click(screen.getByRole("button", { name: /create key account/i }));

    expect(mockJoinMutate).toHaveBeenCalledWith("ws-tok", expect.anything());
    expect(onSuccess).not.toHaveBeenCalled();

    await signUp(user);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", "ws-acme"));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mockJoinMutate).toHaveBeenCalledTimes(1);
  });

  it("signs up from an instance link on an open server with no token, and joins nothing", async () => {
    const user = userEvent.setup();
    const onSuccess = renderLink(InviteTokenType.INSTANCE, "inst-tok", RegistrationMode.OPEN);

    expect(keyTokens()).toEqual({});
    await signUp(user);

    expect(mockJoinMutate).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("user-key", null);
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
    expect(onSuccess).toHaveBeenCalledWith("user-key", null);
  });

  it.each([
    [RegistrationMode.INVITE_ONLY, InviteTokenType.WORKSPACE, "ws-tok", "workspaceInviteToken"],
    [RegistrationMode.INVITE_ONLY, InviteTokenType.INSTANCE, "inst-tok", "instanceInviteToken"],
    [RegistrationMode.POW, InviteTokenType.WORKSPACE, "ws-tok", "workspaceInviteToken"],
    [RegistrationMode.POW, InviteTokenType.INSTANCE, "inst-tok", "instanceInviteToken"],
  ])("still sends the link's token on a %s server (%s)", async (mode, variant, token, field) => {
    const user = userEvent.setup();
    renderLink(variant, token, mode);

    expect(keyTokens()).toEqual({ [field]: token });
    await signUp(user);

    expect(mockJoinMutate).not.toHaveBeenCalled();
  });
});
