import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

const desktop = vi.hoisted(() => ({ value: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => desktop.value,
}));

import { server } from "../../test/mocks/server";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { createGraphqlClient } from "./client";
import { csrfHeader, csrfToken } from "./csrf";

/** Sets the `rim_csrf` cookie, or removes it for `null`. */
function csrfCookie(value: string | null) {
  document.cookie =
    value === null ? "rim_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT" : `rim_csrf=${value}`;
}

describe("csrfToken", () => {
  beforeEach(() => {
    desktop.value = false;
    useAuthStore.setState({ csrfToken: "from-sign-in" });
    csrfCookie("from-cookie");
  });

  afterEach(() => {
    useAuthStore.setState({ csrfToken: null });
    csrfCookie(null);
  });

  it("reads the cookie in the web app, whatever the sign-in returned", () => {
    expect(csrfToken()).toBe("from-cookie");
  });

  it("sends the token the sign-in returned in the desktop app", () => {
    desktop.value = true;
    expect(csrfToken()).toBe("from-sign-in");
  });

  it("falls back to the cookie in the desktop app while it keeps no token", () => {
    desktop.value = true;
    useAuthStore.setState({ csrfToken: null });
    expect(csrfToken()).toBe("from-cookie");
  });

  it("adds the header only when there is a token", () => {
    expect(csrfHeader()).toEqual({ "x-csrf-token": "from-cookie" });
    csrfCookie(null);
    expect(csrfHeader()).toEqual({});
  });

  it("is what the GraphQL client sends in X-CSRF-Token", async () => {
    desktop.value = true;
    let sent: string | null = null;
    server.use(
      http.post("*/api", ({ request }) => {
        sent = request.headers.get("x-csrf-token");
        return HttpResponse.json({ data: { logout: true } });
      }),
    );

    await createGraphqlClient().request("mutation Logout { logout }");

    expect(sent).toBe("from-sign-in");
  });
});
