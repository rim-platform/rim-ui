/**
 * Tests for the invite code field of a signup with no invite link (`JoinForm`'s `CODE`
 * variant): required on an invite-only server and optional otherwise, the token read out of a
 * whole invite link, the server's refusals shown under the field, and the token reaching the
 * signup, or, on an open server, the join that follows it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { fakeServerInfo, renderWithServerInfo } from "../../../test/serverInfo";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    deviceKeyStore: "keyring",
    capabilities: { deviceKeys: true, identityKeys: true },
  }),
}));

const fetchServerInfo = vi.hoisted(() => vi.fn());
vi.mock("../../updater/api/serverInfoApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../updater/api/serverInfoApi")>()),
  fetchServerInfo,
}));

// The key form has its own tests; the stand-in is in `__mocks__`.
vi.mock("./KeySignupForm");

import { JoinForm } from "./JoinForm";
import { PUBLIC_LINK_AT_SIGNUP_MESSAGE, REMOTE_INVITE_MESSAGE } from "../api/useInviteCode";
import { RegistrationMode } from "../types";

const WORKSPACE_TOKEN = "rim_inv_abc123";
const INSTANCE_TOKEN = "rim_iinv_def456";

/** A GraphQL error answer with the server's message and code. */
function refusal(message: string, code: string) {
  return HttpResponse.json({ data: null, errors: [{ message, extensions: { code } }] });
}

/** What the server answers each operation with, by operation name; absent ones go unanswered. */
type Answers = Record<string, (variables: Record<string, unknown>) => Response>;

/** The variables of every operation sent, in order. */
let sent: Array<{ operationName: string; variables: Record<string, unknown> }> = [];

/** A server whose previews know the workspace and the instance token, and refuse others. */
function previewAnswer(variables: Record<string, unknown>): Response {
  if (variables.token === WORKSPACE_TOKEN) {
    return HttpResponse.json({
      data: {
        previewInviteToken: {
          tokenType: "WORKSPACE",
          expiresAt: null,
          workspace: {
            serverId: "ws-acme",
            serverName: "Acme",
            invitedByDisplayName: "Alice",
            ownerDisplayName: "Olga",
          },
        },
      },
    });
  }
  if (variables.token === INSTANCE_TOKEN) {
    return HttpResponse.json({
      data: { previewInviteToken: { tokenType: "INSTANCE", expiresAt: null, workspace: null } },
    });
  }
  return refusal("invalid or unknown token", "INVALID_TOKEN");
}

function answer(overrides: Answers = {}) {
  const answers: Answers = {
    PreviewInviteToken: previewAnswer,
    JoinServerByInvite: () =>
      HttpResponse.json({ data: { joinServerByInvite: { serverId: "ws-acme" } } }),
    ...overrides,
  };
  server.use(
    http.post("*/api", async ({ request }) => {
      const body = (await request.json()) as {
        operationName?: string;
        variables?: Record<string, unknown>;
      };
      const name = body.operationName ?? "";
      const variables = body.variables ?? {};
      sent.push({ operationName: name, variables });
      return answers[name]?.(variables);
    }),
  );
}

function renderForm(mode: RegistrationMode, onSuccess = vi.fn()) {
  renderWithServerInfo(
    <MemoryRouter>
      <JoinForm variant="CODE" token={null} registrationMode={mode} onSuccess={onSuccess} />
    </MemoryRouter>,
  );
  return onSuccess;
}

function codeField(): HTMLInputElement {
  return screen.getByPlaceholderText("Invite code or link");
}

async function pasteCode(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(codeField());
  await user.paste(text);
}

/** The tokens the key form was handed. */
function keyTokens(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "");
}

/** Whether the key form may go ahead. */
function keyReady(): string | null {
  return screen.getByTestId("key-signup-ready").textContent;
}

function finishSignup(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: /finish key signup/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sent = [];
  fetchServerInfo.mockImplementation(async () => fakeServerInfo({}, {}));
});

describe("the invite code field", () => {
  it("is required on an invite-only server and holds the signup back until it is filled", async () => {
    const user = userEvent.setup();
    answer();
    renderForm(RegistrationMode.INVITE_ONLY);

    expect(screen.getByText("Invite code")).toBeInTheDocument();
    expect(codeField()).toBeRequired();
    expect(screen.getByText(/creates accounts by invite only/)).toBeInTheDocument();

    expect(keyReady()).toBe("false");

    await pasteCode(user, INSTANCE_TOKEN);
    expect(await screen.findByText("Invite to this server.")).toBeInTheDocument();
    expect(keyReady()).toBe("true");
  });

  it.each([RegistrationMode.OPEN, RegistrationMode.POW])("is optional on a %s server", (mode) => {
    answer();
    renderForm(mode);

    expect(screen.getByText("Invite code (optional)")).toBeInTheDocument();
    expect(codeField()).not.toBeRequired();
  });

  it("lets an open server's signup go ahead blank, with no token", async () => {
    const user = userEvent.setup();
    answer();
    const onSuccess = renderForm(RegistrationMode.OPEN);

    expect(screen.getByText(/the new account joins that workspace/)).toBeInTheDocument();
    expect(keyReady()).toBe("true");
    await finishSignup(user);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", null));
    expect(keyTokens()).toEqual({});
    expect(sent.some((s) => s.operationName === "PreviewInviteToken")).toBe(false);
  });

  it("reads the token out of a whole invite link and sends it as the workspace invite", async () => {
    const user = userEvent.setup();
    answer();
    const onSuccess = renderForm(RegistrationMode.INVITE_ONLY);

    await pasteCode(user, `https://rim.example.org/join/${WORKSPACE_TOKEN}`);
    expect(
      await screen.findByText("Invite to Acme from Alice. The new account joins it."),
    ).toBeInTheDocument();
    expect(sent.find((s) => s.operationName === "PreviewInviteToken")?.variables).toEqual({
      token: WORKSPACE_TOKEN,
    });

    await finishSignup(user);

    expect(keyTokens()).toEqual({ workspaceInviteToken: WORKSPACE_TOKEN });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("sends an instance invite as the instance token", async () => {
    const user = userEvent.setup();
    answer();
    const onSuccess = renderForm(RegistrationMode.INVITE_ONLY);

    await pasteCode(user, INSTANCE_TOKEN);
    await screen.findByText("Invite to this server.");
    expect(keyTokens()).toEqual({ instanceInviteToken: INSTANCE_TOKEN });
    await finishSignup(user);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", null));
  });

  it("shows the server's message under the field for a code it does not know", async () => {
    const user = userEvent.setup();
    answer();
    renderForm(RegistrationMode.INVITE_ONLY);

    await pasteCode(user, "rim_inv_unknown");

    expect(await screen.findByText("invalid or unknown token")).toBeInTheDocument();
    expect(keyReady()).toBe("false");
  });

  it("shows the server's message under the field when the signup refuses the token", async () => {
    const user = userEvent.setup();
    answer();
    const onSuccess = renderForm(RegistrationMode.INVITE_ONLY);

    await pasteCode(user, INSTANCE_TOKEN);
    await screen.findByText("Invite to this server.");
    await user.click(screen.getByRole("button", { name: /refuse key signup/i }));

    expect(await screen.findByText("token has expired")).toBeInTheDocument();
    // Once, under the field.
    expect(screen.getAllByText("token has expired")).toHaveLength(1);
    expect(keyReady()).toBe("false");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("refuses an invite to a workspace on another server", async () => {
    const user = userEvent.setup();
    answer();
    renderForm(RegistrationMode.INVITE_ONLY);

    await pasteCode(user, "rim-invite:1:rims1_x:hash:rim_inv_abc:https://host.example");

    expect(screen.getByText(REMOTE_INVITE_MESSAGE)).toBeInTheDocument();
    expect(keyReady()).toBe("false");
  });

  it("refuses a workspace's public link, which creates no account, without asking the server", async () => {
    const user = userEvent.setup();
    answer();
    renderForm(RegistrationMode.INVITE_ONLY);

    await pasteCode(user, "https://rim.example.org/join/rim_pjl_AAAAAAAAAAAAAAAAAAAAAA");

    expect(screen.getByText(PUBLIC_LINK_AT_SIGNUP_MESSAGE)).toBeInTheDocument();
    expect(keyReady()).toBe("false");
    expect(sent.filter((op) => op.operationName === "PreviewInviteToken")).toHaveLength(0);
  });
});

describe("an invite code on an open server", () => {
  it("joins the invite's workspace once the account exists, as the server takes no token at signup", async () => {
    const user = userEvent.setup();
    answer();
    const onSuccess = renderForm(RegistrationMode.OPEN);

    await pasteCode(user, WORKSPACE_TOKEN);
    await screen.findByText("Invite to Acme from Alice. The new account joins it.");
    expect(keyTokens()).toEqual({});
    await finishSignup(user);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", "ws-acme"));
    const join = sent.find((s) => s.operationName === "JoinServerByInvite");
    expect(join?.variables).toEqual({ input: { inviteToken: WORKSPACE_TOKEN } });
  });

  it("says the account is ready when joining fails, and goes on without the workspace", async () => {
    const user = userEvent.setup();
    answer({ JoinServerByInvite: () => refusal("permission denied", "FORBIDDEN") });
    const onSuccess = renderForm(RegistrationMode.OPEN);

    await pasteCode(user, WORKSPACE_TOKEN);
    await screen.findByText("Invite to Acme from Alice. The new account joins it.");
    await finishSignup(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your account is ready");
    expect(alert).toHaveTextContent("It could not join Acme: permission denied");
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSuccess).toHaveBeenCalledWith("user-key", null);
  });

  it("says an instance invite is not needed, and sends no token", async () => {
    const user = userEvent.setup();
    answer();
    const onSuccess = renderForm(RegistrationMode.OPEN);

    await pasteCode(user, INSTANCE_TOKEN);
    expect(
      await screen.findByText(
        "This server creates accounts without an invite, so this code is not needed.",
      ),
    ).toBeInTheDocument();
    await finishSignup(user);

    expect(keyTokens()).toEqual({});
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("user-key", null));
    expect(sent.some((s) => s.operationName === "JoinServerByInvite")).toBe(false);
  });
});

describe("the invite code with a key signup", () => {
  it("hands the checked token to the key form, which waits for it on an invite-only server", async () => {
    const user = userEvent.setup();
    answer();
    renderForm(RegistrationMode.INVITE_ONLY);

    expect(screen.getByTestId("key-signup-ready")).toHaveTextContent("false");

    await pasteCode(user, `https://rim.example.org/join/${WORKSPACE_TOKEN}`);
    await waitFor(() => expect(screen.getByTestId("key-signup-ready")).toHaveTextContent("true"));
    expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({
      workspaceInviteToken: WORKSPACE_TOKEN,
    });
    expect(screen.getByTestId("key-signup-workspace")).toHaveTextContent("ws-acme");
  });

  it("hands a pow server's key form the token, in place of the proof-of-work", async () => {
    const user = userEvent.setup();
    answer();
    renderForm(RegistrationMode.POW);

    expect(screen.getByTestId("key-signup-ready")).toHaveTextContent("true");
    await pasteCode(user, INSTANCE_TOKEN);
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("key-signup-tokens").textContent ?? "")).toEqual({
        instanceInviteToken: INSTANCE_TOKEN,
      }),
    );
  });
});
