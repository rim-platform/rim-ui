import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { setSessionSecret } from "../../../core/graphql/sessionSecret";
import { FeatureDisabledError } from "../../../core/serverFeatures";
import { uploadAvatar } from "./useUpdateProfile";

describe("uploadAvatar", () => {
  const image = new Blob(["png"], { type: "image/png" });

  it("refuses with a FeatureDisabledError while profile pictures are switched off", async () => {
    server.use(
      http.post("*/api/files/avatar", () =>
        HttpResponse.json(
          {
            error: "the avatars feature is not available on this server",
            code: "FEATURE_DISABLED",
            feature: "avatars",
          },
          { status: 403 },
        ),
      ),
    );

    const err = await uploadAvatar(image).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as FeatureDisabledError).feature).toBe("avatars");
    expect((err as FeatureDisabledError).message).toBe(
      "Profile pictures are switched off on this server",
    );
  });

  it("says in minutes, rounded up, when the next picture may be uploaded", async () => {
    server.use(
      http.post("*/api/files/avatar", () =>
        HttpResponse.json(
          { error: "too many picture uploads", retryAfterSeconds: 1500 },
          { status: 429, headers: { "Retry-After": "1500" } },
        ),
      ),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(
      /^You can change your picture again in 25 minutes\.$/,
    );
  });

  it("falls back to the Retry-After header and says one minute in the singular", async () => {
    server.use(
      http.post(
        "*/api/files/avatar",
        () => new HttpResponse("slow down", { status: 429, headers: { "Retry-After": "45" } }),
      ),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(
      /^You can change your picture again in 1 minute\.$/,
    );
  });

  it("shows a refused picture in the server's words", async () => {
    server.use(
      http.post("*/api/files/avatar", () =>
        HttpResponse.json(
          { error: "this image isn't allowed as a profile picture" },
          { status: 422 },
        ),
      ),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(
      /^This image isn't allowed as a profile picture\.$/,
    );
  });

  it("shows an unavailable picture check in the server's words", async () => {
    server.use(
      http.post("*/api/files/avatar", () =>
        HttpResponse.json(
          { error: "profile pictures can't be checked right now; try again later" },
          { status: 503 },
        ),
      ),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(
      /^Profile pictures can't be checked right now; try again later\.$/,
    );
  });

  it("keeps the server's full stop on a too-large upload", async () => {
    server.use(
      http.post("*/api/files/avatar", () =>
        HttpResponse.json({ error: "file too large." }, { status: 413 }),
      ),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(/^File too large\.$/);
  });

  it("keeps the status error for a refusal without a JSON message", async () => {
    server.use(
      http.post(
        "*/api/files/avatar",
        () => new HttpResponse("<html>oops</html>", { status: 500, statusText: "Server Error" }),
      ),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(/^Avatar upload failed: 500 Server Error$/);
  });

  it("returns the stored avatar's URL", async () => {
    server.use(
      http.post("*/api/files/avatar", () =>
        HttpResponse.json({ url: "/api/files/avatars/u1/avatar.png" }),
      ),
    );

    await expect(uploadAvatar(image)).resolves.toBe("/api/files/avatars/u1/avatar.png");
  });

  it("sends the session secret of an unkept session with the upload", async () => {
    let secret: string | null = null;
    server.use(
      http.post("*/api/files/avatar", ({ request }) => {
        secret = request.headers.get("x-rim-session-secret");
        return HttpResponse.json({ url: "/api/files/avatars/u1/avatar.png" });
      }),
    );
    setSessionSecret("c2VjcmV0");
    try {
      await uploadAvatar(image);
    } finally {
      setSessionSecret(null);
    }
    expect(secret).toBe("c2VjcmV0");
  });
});
