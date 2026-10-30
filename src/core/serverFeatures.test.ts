import { describe, it, expect } from "vitest";

import {
  featureDisabledFromResponse,
  FeatureDisabledError,
  featureOffMessage,
  featureUnavailableMessage,
  isKnownServerFeature,
  serverFeatureLabel,
} from "./serverFeatures";

describe("server feature names", () => {
  it("knows the server's features and reads an unknown key as itself", () => {
    expect(isKnownServerFeature("custom_emoji")).toBe(true);
    expect(isKnownServerFeature("teleport")).toBe(false);
    expect(serverFeatureLabel("custom_emoji")).toBe("Custom emoji");
    expect(serverFeatureLabel("teleport")).toBe("teleport");
  });

  it("words a switched-off and a not-set-up feature", () => {
    expect(featureOffMessage("email")).toBe("Email is switched off on this server");
    expect(featureOffMessage("attachments")).toBe("Attachments are switched off on this server");
    expect(featureOffMessage("avatars")).toBe("Profile pictures are switched off on this server");
    expect(featureUnavailableMessage("email")).toBe("Email is not set up on this server");
    expect(featureOffMessage("text_art_check")).toBe(
      "Text art check is switched off on this server",
    );
    expect(featureUnavailableMessage("avatar_check")).toBe(
      "Profile picture check is not set up on this server",
    );
  });
});

describe("featureDisabledFromResponse", () => {
  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("reads the feature off a 403 FEATURE_DISABLED answer and leaves the body readable", async () => {
    const response = json(403, {
      error: "the attachments feature is not available on this server",
      code: "FEATURE_DISABLED",
      feature: "attachments",
    });
    const err = await featureDisabledFromResponse(response);

    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect(err?.feature).toBe("attachments");
    expect(err?.message).toBe("Attachments are switched off on this server");
    expect(await response.json()).toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("is null for another 403, another status and a body that is not JSON", async () => {
    expect(await featureDisabledFromResponse(json(403, { error: "forbidden" }))).toBeNull();
    expect(
      await featureDisabledFromResponse(json(409, { code: "FEATURE_DISABLED", feature: "x" })),
    ).toBeNull();
    expect(await featureDisabledFromResponse(new Response("nope", { status: 403 }))).toBeNull();
  });
});
