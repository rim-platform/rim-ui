import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/mocks/server";
import { FeatureDisabledError } from "../../../core/serverFeatures";
import { uploadFileRest } from "./useAttachments";

describe("uploadFileRest", () => {
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });

  it("refuses with a FeatureDisabledError while attachments are switched off", async () => {
    server.use(
      http.post("*/api/files/upload", () =>
        HttpResponse.json(
          {
            error: "the attachments feature is not available on this server",
            code: "FEATURE_DISABLED",
            feature: "attachments",
          },
          { status: 403 },
        ),
      ),
    );

    const err = await uploadFileRest(file, "tok", "att-1", "ws-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as FeatureDisabledError).feature).toBe("attachments");
  });

  it("keeps the status error for any other refusal", async () => {
    server.use(
      http.post("*/api/files/upload", () => HttpResponse.json({ error: "nope" }, { status: 403 })),
    );

    await expect(uploadFileRest(file, "tok", "att-1", "ws-1")).rejects.toThrow(
      /Upload failed: 403/,
    );
  });

  it("resolves on success", async () => {
    server.use(http.post("*/api/files/upload", () => new HttpResponse(null, { status: 204 })));
    await expect(uploadFileRest(file, "tok", "att-1", "ws-1")).resolves.toBeUndefined();
  });
});
