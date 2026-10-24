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

  it("keeps the status error for any other refusal", async () => {
    server.use(
      http.post("*/api/files/avatar", () => HttpResponse.json({ error: "nope" }, { status: 403 })),
    );

    await expect(uploadAvatar(image)).rejects.toThrow(/Avatar upload failed: 403/);
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
