import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
const mockSetSession = vi.fn();

vi.mock("../../system/api/useHealthCheck", () => ({
  useHealthCheck: () => ({ isSuccess: true, isError: false, isPending: false }),
}));

vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Not hydrating, no existing session
const needsConnection = vi.hoisted(() => ({ value: false }));
vi.mock("../api/useSessionHydration", () => ({
  NEEDS_CONNECTION_MESSAGE: "Signing in needs a connection to the server",
  useSessionHydration: () => ({
    isHydrating: false,
    isAuthenticated: false,
    needsConnection: needsConnection.value,
  }),
}));

// Auth store: always null session to avoid redirect-to-login side effects.
// The LoginPage component renders null when session is truthy, so keeping it
// consistently null ensures the form is always rendered during tests.
const sessionEnded = vi.hoisted(() => ({ value: false }));
vi.mock("../state/useAuthStore", () => ({
  useAuthStore: (
    selector: (s: {
      session: null;
      sessionEnded: boolean;
      setSession: typeof mockSetSession;
    }) => unknown,
  ) => selector({ session: null, sessionEnded: sessionEnded.value, setSession: mockSetSession }),
}));

// Default server config: INVITE_ONLY
const mockUseServerConfig = vi.fn(() => ({
  data: { registrationMode: "INVITE_ONLY" },
  isPending: false,
  isError: false,
}));

vi.mock("../api/useServerConfig", () => ({
  useServerConfig: () => mockUseServerConfig(),
}));

// Whether this app can create identity keys, and the key store while the browser is probed.
const keys = vi.hoisted(() => ({
  value: true,
  store: "keyring" as "keyring" | "browser" | "checking",
}));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    capabilities: { identityKeys: keys.value },
    deviceKeyStore: keys.store,
  }),
}));

// Device key sign-in, device linking and recovery have their own tests; here each renders a
// stand-in button when `keyOptions.value` is set, and nothing otherwise, as in the web app.
const keyOptions = vi.hoisted(() => ({ value: false }));
vi.mock("../../key-identity/components/DeviceKeySignIn", () => ({
  DeviceKeySignIn: () =>
    keyOptions.value ? <button type="button">Device key sign-in</button> : null,
  RecoverAccount: () =>
    keyOptions.value ? <button type="button">Recover an account</button> : null,
}));
vi.mock("../../key-identity/components/LinkThisDevice", () => ({
  LinkThisDevice: () => (keyOptions.value ? <button type="button">Link this device</button> : null),
}));

// Server info comes from each test's query client; one without it stays loading.
vi.mock("../../updater/api/serverInfoApi", async () => {
  const actual = await vi.importActual<typeof import("../../updater/api/serverInfoApi")>(
    "../../updater/api/serverInfoApi",
  );
  return { ...actual, fetchServerInfo: () => new Promise(() => {}) };
});

import { LoginPage } from "./LoginPage";
import { NO_KEYS_HERE_MESSAGE } from "./NoKeysHere";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import {
  withServerInfo,
  type FakeFeatures,
  type FakeServerDetails,
} from "../../../test/serverInfo";
import { useEdgeStore } from "../../../core/graphql/edgeRefusals";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keys.value = true;
    keys.store = "keyring";
    sessionEnded.value = false;
    needsConnection.value = false;
    keyOptions.value = false;
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "INVITE_ONLY" },
      isPending: false,
      isError: false,
    });
  });

  function renderPage(features: FakeFeatures = {}, details: FakeServerDetails = {}) {
    return render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
      { wrapper: withServerInfo(features, details) },
    );
  }

  it("renders the heading and the key ways to sign in, with no password form", () => {
    keyOptions.value = true;
    renderPage();
    expect(screen.getByRole("heading", { name: "RIM" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to your workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Device key sign-in" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("offers Create account, which takes an invite code, when registrationMode is INVITE_ONLY", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/join");
    expect(
      screen.getByText(
        "Creating an account here takes an invite code or link from someone on this server.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No account? Ask your workspace admin for an invite."),
    ).not.toBeInTheDocument();
  });

  it("says nothing about invite codes when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
      isError: false,
    });
    renderPage();
    expect(screen.queryByText(/takes an invite code/)).not.toBeInTheDocument();
  });

  it("renders the Create account link when registrationMode is OPEN", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "OPEN" },
      isPending: false,
      isError: false,
    });
    renderPage();
    const link = screen.getByRole("link", { name: "Create account" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/join");
  });

  it("renders the Create account link where this app holds keys when registrationMode is POW", () => {
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "POW" },
      isPending: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/join");
  });

  it.each(["OPEN", "INVITE_ONLY", "POW"])(
    "says a browser without keys cannot hold an account, in place of the key ways, on a %s server",
    (registrationMode) => {
      keys.value = false;
      keys.store = "browser";
      keyOptions.value = true;
      mockUseServerConfig.mockReturnValue({
        data: { registrationMode },
        isPending: false,
        isError: false,
      });
      renderPage();
      expect(screen.getByText(NO_KEYS_HERE_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Sign in with a key" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Device key sign-in" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
      expect(screen.queryByText(/^No account\?/)).not.toBeInTheDocument();
    },
  );

  it("shows the key ways to sign in while the browser is still probed", () => {
    keys.value = false;
    keys.store = "checking";
    keyOptions.value = true;
    renderPage();
    expect(screen.getByRole("button", { name: "Device key sign-in" })).toBeInTheDocument();
    expect(screen.queryByText(NO_KEYS_HERE_MESSAGE)).not.toBeInTheDocument();
  });

  it("points to the desktop app or an invite on a POW server while the browser is probed", () => {
    keys.value = false;
    keys.store = "checking";
    mockUseServerConfig.mockReturnValue({
      data: { registrationMode: "POW" },
      isPending: false,
      isError: false,
    });
    renderPage();
    expect(
      screen.getByText("No account? Create one in the RIM desktop app, or ask for an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("hides the Create account link while registrationMode is loading — defaults to invite-only", () => {
    mockUseServerConfig.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderPage();
    expect(
      screen.getByText("No account? Ask your workspace admin for an invite."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
  });

  it("reaches the key ways to sign in and Create account by keyboard", async () => {
    keyOptions.value = true;
    const user = userEvent.setup();
    renderPage();
    await expectReachableByKeyboard(user, [
      screen.getByRole("button", { name: "Device key sign-in" }),
      screen.getByRole("button", { name: "Link this device" }),
      screen.getByRole("button", { name: "Recover an account" }),
      screen.getByRole("link", { name: "Create account" }),
    ]);
  });

  it("shows the server's instance notice at the top, as plain text", () => {
    renderPage({}, { instanceNotice: "Run by **Acme**.\nBe kind." });
    const notice = screen.getByRole("note", { name: "Notice from this server" });
    expect(notice).toHaveTextContent("Run by **Acme**. Be kind.");
    expect(notice.querySelector("strong")).toBeNull();
  });

  it.each([null, undefined, "  "])("shows no notice when the server gives %j", (notice) => {
    renderPage({}, { instanceNotice: notice });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("says the server is full instead of offering Create account", () => {
    keyOptions.value = true;
    renderPage({}, { registrationFull: true });
    expect(screen.getByText("This server is full")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Device key sign-in" })).toBeInTheDocument();
  });

  it("shows the server's abuse contact, and none without one", () => {
    const { unmount } = renderPage({}, { abuseContact: "abuse@acme.example" });
    expect(screen.getByRole("link", { name: "abuse@acme.example" })).toHaveAttribute(
      "href",
      "mailto:abuse@acme.example",
    );
    unmount();

    renderPage({}, { abuseContact: null });
    expect(screen.queryByText(/Report abuse/)).not.toBeInTheDocument();
  });

  it("says the address is blocked when the server refused it", () => {
    useEdgeStore.setState({ blocked: true });
    try {
      renderPage();
      expect(screen.getByRole("alert")).toHaveTextContent("This address is blocked on this server");
      expect(screen.getByText("Address blocked")).toBeInTheDocument();
    } finally {
      useEdgeStore.setState({ blocked: false });
    }
  });

  it("shows no blocked state otherwise", () => {
    renderPage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers the key ways to sign in in a card of their own", () => {
    keyOptions.value = true;
    renderPage();

    const card = screen.getByRole("region", { name: "Sign in with a key" });
    expect(card).toContainElement(screen.getByRole("button", { name: "Device key sign-in" }));
    expect(card).toContainElement(screen.getByRole("button", { name: "Link this device" }));
    expect(card).toContainElement(screen.getByRole("button", { name: "Recover an account" }));
  });

  it("leaves the key card empty where no key way renders", () => {
    renderPage();
    expect(screen.getByLabelText("Sign in with a key")).toBeEmptyDOMElement();
  });

  it("says the session ended when the server ended it, and nothing otherwise", () => {
    const { unmount } = renderPage();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();

    sessionEnded.value = true;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Your session ended. Sign in again.");
  });

  it("says signing in needs the server while an account that is not kept starts offline", () => {
    needsConnection.value = true;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Signing in needs a connection to the server",
    );
  });
});
