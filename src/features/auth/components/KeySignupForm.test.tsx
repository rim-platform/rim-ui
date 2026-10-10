import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClientError } from "graphql-request";

import { createTestQueryClient } from "../../../test/utils";

const api = vi.hoisted(() => ({
  defaultDeviceName: vi.fn(),
  beginEnrollment: vi.fn(),
  signupWithKey: vi.fn(),
  discardKeySignup: vi.fn(),
  abandonKeySignup: vi.fn(),
}));

vi.mock("../../key-identity/api/keyIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../key-identity/api/keyIdentity")>()),
  ...api,
}));
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

import { KeyChallengeFailed, type KeySignupOptions } from "../../key-identity/api/keyIdentity";
import { PowCancelled } from "../../relay/pow/proofOfWork";
import { KeySignupForm, type KeySignupTokens } from "./KeySignupForm";

const PHRASE = "abandon amount liar amount expire adjust cage candy arch gather drum buyer".split(
  " ",
);
const draft = {
  draftId: "draft-1",
  principalId: "rimp1_ada",
  inceptionPayload: "{}",
  recoveryKit: `RIM recovery kit (v2)\nAccount id: rimp1_ada\nRecovery phrase: ${PHRASE.join(" ")}\n`,
  recoveryPhrase: PHRASE,
};

function serverError(code: string, message = code, extensions: Record<string, unknown> = {}) {
  return new ClientError(
    {
      status: 200,
      headers: new Headers(),
      errors: [{ message, extensions: { code, ...extensions } }],
    },
    { query: "" },
  );
}

function renderForm(
  tokens: KeySignupTokens = { instanceInviteToken: "inst-tok" },
  workspaceId?: string,
) {
  const qc = createTestQueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const onSuccess = vi.fn();
  const onBusyChange = vi.fn();
  const view = render(
    <QueryClientProvider client={qc}>
      <KeySignupForm
        tokens={tokens}
        workspaceId={workspaceId}
        onSuccess={onSuccess}
        onBusyChange={onBusyChange}
      />
    </QueryClientProvider>,
  );
  return { ...view, onSuccess, onBusyChange, invalidate };
}

/** jsdom has no Clipboard API; stub it so the copy button is testable. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

/** Fill in the name, create the keys and tick "I saved it". */
async function reachKit(user: ReturnType<typeof userEvent.setup>, username = "ada") {
  await waitFor(() => expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"));
  await user.type(screen.getByLabelText(/^username/i), username);
  await user.click(screen.getByRole("button", { name: /create keys/i }));
  await screen.findByLabelText("Recovery phrase");
  await user.click(screen.getByRole("checkbox"));
}

describe("KeySignupForm", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.defaultDeviceName.mockResolvedValue("Laptop");
    api.beginEnrollment.mockResolvedValue(draft);
    api.abandonKeySignup.mockResolvedValue(undefined);
    api.discardKeySignup.mockResolvedValue(null);
  });

  it("asks for a username, an optional display name and this device's name, with no password or email", async () => {
    renderForm();

    expect(screen.getByLabelText(/^username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display name \(optional\)/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    // A username is needed before any key is made.
    expect(screen.getByRole("button", { name: /create keys/i })).toBeDisabled();
  });

  it("shows the recovery kit and creates the account only once the person saved it", async () => {
    const user = userEvent.setup();
    api.signupWithKey.mockResolvedValue({ userId: "u-ada", serverId: null });
    const { onSuccess, onBusyChange, invalidate } = renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await user.clear(screen.getByLabelText(/name of this device/i));
    await user.type(screen.getByLabelText(/name of this device/i), "Work laptop");
    await user.type(screen.getByLabelText(/^username/i), "ada");
    await user.click(screen.getByRole("button", { name: /create keys/i }));

    expect(api.beginEnrollment).toHaveBeenCalledWith("Work laptop");
    const grid = await screen.findByLabelText("Recovery phrase");
    expect(within(grid).getAllByRole("listitem")).toHaveLength(12);
    expect(screen.getByText("rimp1_ada")).toBeInTheDocument();
    // The device name is in the keys' certificate now.
    expect(screen.queryByLabelText(/name of this device/i)).toBeNull();

    const create = screen.getByRole("button", { name: /^create account$/i });
    expect(create).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(create).toBeEnabled();
    await user.click(create);

    expect(api.signupWithKey).toHaveBeenCalledWith(
      draft,
      { username: "ada", instanceInviteToken: "inst-tok" },
      expect.anything(),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-ada", null));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"] });
    // The page keeps the form mounted while a step runs.
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    // The phrase leaves the screen once the account has its keys.
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    expect(api.abandonKeySignup).not.toHaveBeenCalled();
  });

  it("sends a trimmed display name and the page's token, and passes on the server id", async () => {
    const user = userEvent.setup();
    api.signupWithKey.mockResolvedValue({ userId: "u-ada", serverId: "srv-1" });
    const { onSuccess } = renderForm({ workspaceInviteToken: "ws-tok" });

    await user.type(screen.getByLabelText(/display name/i), "  Ada L.  ");
    await reachKit(user, "  ada ");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    expect(api.signupWithKey).toHaveBeenCalledWith(
      draft,
      { username: "ada", displayName: "Ada L.", workspaceInviteToken: "ws-tok" },
      expect.anything(),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-ada", "srv-1"));
  });

  it("refuses a display name longer than 80 characters before making keys", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await user.type(screen.getByLabelText(/^username/i), "ada");
    await user.type(screen.getByLabelText(/display name/i), "x".repeat(81));
    await user.click(screen.getByRole("button", { name: /create keys/i }));

    expect(screen.getByText(/at most 80 characters/i)).toBeInTheDocument();
    expect(api.beginEnrollment).not.toHaveBeenCalled();
  });

  it("shows a taken username under the field and retries with the same keys", async () => {
    const user = userEvent.setup();
    api.signupWithKey
      .mockRejectedValueOnce(serverError("CONFLICT", "username already exists"))
      .mockResolvedValueOnce({ userId: "u-ada", serverId: null });
    const { onSuccess } = renderForm();

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    expect(await screen.findByText("This username is taken. Choose another.")).toBeInTheDocument();
    // The kit stays on screen: the keys are the same for the next try.
    expect(screen.getByLabelText("Recovery phrase")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^username/i), "2");
    expect(screen.queryByText("This username is taken. Choose another.")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    expect(api.beginEnrollment).toHaveBeenCalledTimes(1);
    expect(api.signupWithKey).toHaveBeenLastCalledWith(
      draft,
      { username: "ada2", instanceInviteToken: "inst-tok" },
      expect.anything(),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-ada", null));
  });

  it("shows the proof-of-work with its time, says why it is slow, and can cancel it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      api.signupWithKey.mockImplementationOnce(
        (_draft: unknown, _fields: unknown, options: KeySignupOptions) =>
          new Promise((_resolve, reject) => {
            options.onProofOfWork?.(24);
            options.signal?.addEventListener("abort", () => reject(new PowCancelled()));
          }),
      );
      const { onBusyChange } = renderForm({});

      await reachKit(user);
      await user.click(screen.getByRole("button", { name: /^create account$/i }));

      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(/proving this is a real device/i);
      expect(status).not.toHaveTextContent(/million/);
      act(() => {
        vi.advanceTimersByTime(11_000);
      });
      expect(status).toHaveTextContent(/1[12] s/);
      expect(status).toHaveTextContent(/16\.8 million hashes/);
      expect(status).toHaveTextContent(/seconds in the desktop app.*tens of seconds in a browser/);
      expect(onBusyChange).toHaveBeenLastCalledWith(true);

      await user.click(within(status).getByRole("button", { name: /cancel/i }));

      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByLabelText("Recovery phrase")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^create account$/i })).toBeEnabled();
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the server's words when it refuses the proof-of-work and offers to try again", async () => {
    const user = userEvent.setup();
    api.signupWithKey
      .mockRejectedValueOnce(
        serverError("VALIDATION", "proofOfWork does not have the required leading zero bits"),
      )
      .mockResolvedValueOnce({ userId: "u-ada", serverId: null });
    const { onSuccess } = renderForm({});

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("proofOfWork does not have the required leading zero bits");
    await user.click(within(alert).getByRole("button", { name: /try again/i }));

    expect(api.signupWithKey).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-ada", null));
  });

  it("offers no retry button for a refusal that is not about the proof-of-work", async () => {
    const user = userEvent.setup();
    api.signupWithKey.mockRejectedValueOnce(
      serverError("FORBIDDEN", "this key identity is blocked on this server"),
    );
    renderForm({});

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("this key identity is blocked on this server");
    expect(within(alert).queryByRole("button")).toBeNull();
  });

  it.each([
    [
      "a key identity already in use",
      serverError("CONFLICT", "another account on this server already uses this key identity"),
      /already uses these keys/i,
    ],
    [
      "a validation error, in the server's words",
      serverError("VALIDATION", "username must be 3 to 32 characters"),
      /username must be 3 to 32 characters/,
    ],
    [
      "a rate limit, with the wait",
      serverError("RATE_LIMITED", "rate limit exceeded", { retryAfterSeconds: 300 }),
      /too many sign-ups.*try again in 5 minutes/i,
    ],
    [
      "a rate limit on the challenge, as attempts rather than sign-ups",
      new KeyChallengeFailed(serverError("RATE_LIMITED")),
      /too many attempts.*wait a minute/i,
    ],
    ["an invalid token", serverError("INVALID_TOKEN"), /invite link is no longer valid/i],
    ["an expired token", serverError("EXPIRED_TOKEN"), /invite link has expired/i],
    [
      "a refused signature",
      serverError("UNAUTHENTICATED"),
      /did not accept this computer's signature/i,
    ],
    ["any other failure", new Error("Network down"), /network down/i],
  ])("explains %s and keeps the draft", async (_case, error, text) => {
    const user = userEvent.setup();
    api.signupWithKey.mockRejectedValueOnce(error);
    const { onSuccess } = renderForm();

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Recovery phrase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create account$/i })).toBeEnabled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(api.abandonKeySignup).not.toHaveBeenCalled();
  });

  it("discards the keys and starts over", async () => {
    const user = userEvent.setup();
    api.signupWithKey.mockRejectedValueOnce(serverError("EXPIRED_TOKEN"));
    renderForm();

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /discard keys/i }));

    expect(api.discardKeySignup).toHaveBeenCalledWith(draft);
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByRole("button", { name: /create keys/i })).toBeInTheDocument();
  });

  it("gives up on the keys when the page closes before the account is created", async () => {
    const user = userEvent.setup();
    const { unmount } = renderForm();

    await reachKit(user);
    unmount();

    expect(api.abandonKeySignup).toHaveBeenCalledWith(draft);
  });

  it("explains a failure to create the keys", async () => {
    const user = userEvent.setup();
    api.beginEnrollment.mockRejectedValueOnce(new Error("key storage: locked"));
    renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText(/name of this device/i)).toHaveValue("Laptop"),
    );
    await user.type(screen.getByLabelText(/^username/i), "ada");
    await user.click(screen.getByRole("button", { name: /create keys/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/key storage: locked/);
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
  });

  it("opens the account when discarding finds that a failed attempt created it", async () => {
    const user = userEvent.setup();
    api.signupWithKey.mockRejectedValueOnce(new Error("Network down"));
    api.discardKeySignup.mockResolvedValueOnce({ userId: "u-ada", serverId: null });
    const { onSuccess } = renderForm({ workspaceInviteToken: "ws-tok" }, "srv-preview");

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /discard keys/i }));

    // The answer naming the workspace was lost; the invite's preview names it.
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-ada", "srv-preview"));
  });

  it("lands in the previewed workspace when the account was found after a lost answer", async () => {
    const user = userEvent.setup();
    api.signupWithKey.mockResolvedValue({ userId: "u-ada", serverId: null });
    const { onSuccess } = renderForm({ workspaceInviteToken: "ws-tok" }, "srv-preview");

    await reachKit(user);
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u-ada", "srv-preview"));
  });

  it("says when the kit could not be copied", async () => {
    const user = userEvent.setup();
    renderForm();
    await reachKit(user);

    // userEvent installs its own clipboard; stub after it, and click without it.
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    fireEvent.click(screen.getByRole("button", { name: /copy kit/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not copy/i);
  });
});
