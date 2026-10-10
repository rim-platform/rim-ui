import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { useToastStore } from "../../shared/toast";
import { toast } from "../../shared/toast";
import { graphqlErrorMessage } from "../graphql/errors";
import { FeatureDisabledError } from "../serverFeatures";
import { queryKeys } from "./keys";
import { createAppQueryClient, featureDisabledToastId, reportFeatureDisabled } from "./queryClient";

const emojiOff = Object.assign(new Error("serialized"), {
  response: {
    errors: [
      {
        message: "the custom_emoji feature is not available on this server",
        extensions: { code: "FEATURE_DISABLED", feature: "custom_emoji" },
      },
    ],
  },
});

function toasts() {
  return useToastStore.getState().toasts;
}

describe("reportFeatureDisabled", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("toasts the switched-off feature and rereads the server's features", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.serverInfo, { version: "1", apiVersion: 1, features: [] });

    expect(reportFeatureDisabled(new FeatureDisabledError("attachments"), client)).toBe(true);

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      id: featureDisabledToastId("attachments"),
      variant: "error",
      title: "Attachments are switched off on this server",
    });
    expect(client.getQueryState(queryKeys.serverInfo)?.isInvalidated).toBe(true);
  });

  it("leaves any other error alone", () => {
    expect(reportFeatureDisabled(new Error("boom"), new QueryClient())).toBe(false);
    expect(toasts()).toHaveLength(0);
  });
});

describe("createAppQueryClient", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("toasts a mutation refused for a disabled feature once, even when the caller toasts too", async () => {
    const client = createAppQueryClient();
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(emojiOff),
      onError: (err: Error) => {
        toast.error(graphqlErrorMessage(err, "fallback"));
      },
    });

    await expect(mutation.execute(undefined)).rejects.toBe(emojiOff);

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe("Custom emoji is switched off on this server");
  });

  it("toasts a query refused for a disabled feature", async () => {
    const client = createAppQueryClient();
    await client
      .fetchQuery({ queryKey: ["emoji"], queryFn: () => Promise.reject(emojiOff), retry: false })
      .catch(() => undefined);

    expect(toasts().map((t) => t.id)).toEqual([featureDisabledToastId("custom_emoji")]);
  });

  it("says nothing for other failures", async () => {
    const client = createAppQueryClient();
    await client
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => Promise.reject(new Error("boom")),
        retry: false,
      })
      .catch(() => undefined);

    expect(toasts()).toHaveLength(0);
  });
});
