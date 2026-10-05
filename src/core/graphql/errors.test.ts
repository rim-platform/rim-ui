import { describe, it, expect } from "vitest";

import {
  FEATURE_DISABLED,
  FeatureDisabledError,
  graphqlErrorCode,
  graphqlErrorMessage,
} from "./errors";

const featureDisabled = Object.assign(new Error('Feature disabled: {"response":{}}'), {
  response: {
    errors: [
      {
        message: "The incidents feature is disabled for this workspace",
        extensions: { code: "FEATURE_DISABLED", feature: "incidents" },
      },
    ],
  },
});

describe("graphqlErrorCode", () => {
  it("reads extensions.code off the first GraphQL error", () => {
    expect(graphqlErrorCode(featureDisabled)).toBe(FEATURE_DISABLED);
  });

  it("reports FEATURE_DISABLED for the client-side FeatureDisabledError", () => {
    expect(graphqlErrorCode(new FeatureDisabledError("off"))).toBe(FEATURE_DISABLED);
  });

  it("is undefined for plain errors and non-objects", () => {
    expect(graphqlErrorCode(new Error("boom"))).toBeUndefined();
    expect(graphqlErrorCode("boom")).toBeUndefined();
    expect(graphqlErrorCode(null)).toBeUndefined();
    expect(graphqlErrorCode({ response: { errors: [] } })).toBeUndefined();
  });
});

describe("graphqlErrorMessage", () => {
  it("prefers the server's message over the serialized ClientError message", () => {
    expect(graphqlErrorMessage(featureDisabled, "fallback")).toBe(
      "The incidents feature is disabled for this workspace",
    );
  });

  it("falls back to Error.message, then to the fallback", () => {
    expect(graphqlErrorMessage(new Error("network down"), "fallback")).toBe("network down");
    expect(graphqlErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});
