import { afterEach, describe, expect, it, vi } from "vitest";

import { getGraphqlEndpoint, usesMovedRelay } from "../../../core/graphql/config";
import {
  SERVER_ADDRESS_CREDENTIALS,
  SERVER_ADDRESS_EMPTY,
  SERVER_ADDRESS_INSECURE,
  SERVER_ADDRESS_INVALID,
  parseServerAddress,
  switchServer,
} from "./serverAddress";

describe("parseServerAddress", () => {
  it.each([
    ["https://rim.example.org", "https://rim.example.org/api", "rim.example.org"],
    ["https://rim.example.org/", "https://rim.example.org/api", "rim.example.org"],
    ["rim.example.org", "https://rim.example.org/api", "rim.example.org"],
    [
      "  https://rim.example.org:8443  ",
      "https://rim.example.org:8443/api",
      "rim.example.org:8443",
    ],
    ["https://example.org/rim/api/", "https://example.org/rim/api", "example.org"],
    ["http://localhost:8080", "http://localhost:8080/api", "localhost:8080"],
    ["http://127.0.0.1:8080/api", "http://127.0.0.1:8080/api", "127.0.0.1:8080"],
    ["https://rim.example.org/?x=1#top", "https://rim.example.org/api", "rim.example.org"],
  ])("reads %s as the endpoint %s", (input, endpoint, host) => {
    expect(parseServerAddress(input)).toEqual({ endpoint, host });
  });

  it.each([
    ["", SERVER_ADDRESS_EMPTY],
    ["   ", SERVER_ADDRESS_EMPTY],
    ["https://", SERVER_ADDRESS_INVALID],
    ["https://rim example.org", SERVER_ADDRESS_INVALID],
    ["http://rim.example.org", SERVER_ADDRESS_INSECURE],
    ["http://192.168.1.10:8080", SERVER_ADDRESS_INSECURE],
    ["ftp://rim.example.org", SERVER_ADDRESS_INSECURE],
    ["https://me:secret@rim.example.org", SERVER_ADDRESS_CREDENTIALS],
  ])("refuses %j", (input, error) => {
    expect(parseServerAddress(input)).toEqual({ error });
  });
});

describe("switchServer on the desktop", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("stores the endpoint, which the app then uses, and reloads", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const reload = vi.fn();

    switchServer("https://rim.example.org/api", reload);

    expect(reload).toHaveBeenCalledOnce();
    expect(usesMovedRelay()).toBe(true);
    expect(getGraphqlEndpoint()).toBe("https://rim.example.org/api");
  });

  it("goes back to the default server and reloads", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    switchServer("https://rim.example.org/api", vi.fn());
    const reload = vi.fn();

    switchServer(null, reload);

    expect(reload).toHaveBeenCalledOnce();
    expect(usesMovedRelay()).toBe(false);
    expect(getGraphqlEndpoint()).toBe("http://localhost:8080/api");
  });
});
