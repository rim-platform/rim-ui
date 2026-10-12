import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { useToastStore } from "../../shared/toast";
import { toast } from "../../shared/toast";
import { AddressBlockedError, graphqlErrorMessage } from "../graphql/errors";
import { FeatureDisabledError } from "../serverFeatures";
import { queryKeys } from "./keys";
import {
  createAppQueryClient,
  featureDisabledToastId,
  queryRetryDelay,
  reportFeatureDisabled,
  shouldRetryQuery,
} from "./queryClient";

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

describe("query retries", () => {
  const rateLimited = (retryAfterSeconds?: number) =>
    Object.assign(new Error("serialized"), {
      response: {
        errors: [
          {
            message: "Too many requests from this address",
            extensions: { code: "RATE_LIMITED", retryAfterSeconds },
          },
        ],
      },
    });

  afterEach(() => vi.useRealTimers());

  it("retries once, and never for a blocked address", () => {
    expect(shouldRetryQuery(0, new Error("boom"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("boom"))).toBe(false);
    expect(shouldRetryQuery(0, new AddressBlockedError())).toBe(false);
  });

  it("waits the seconds a rate limit names, else backs off", () => {
    expect(queryRetryDelay(0, rateLimited(45))).toBe(45_000);
    expect(queryRetryDelay(0, rateLimited())).toBe(30_000);
    expect(queryRetryDelay(0, new Error("boom"))).toBe(1000);
    expect(queryRetryDelay(5, new Error("boom"))).toBe(30_000);
  });

  it("holds a rate-limited query's retry until the server's wait is over", async () => {
    vi.useFakeTimers();
    const client = createAppQueryClient();
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimited(5))
      .mockResolvedValue("ok");
    const observer = new QueryObserver(client, { queryKey: ["limited"], queryFn });
    const stop = observer.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(4_900);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toBe("ok");
    stop();
  });
});
