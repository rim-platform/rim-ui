import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../core/graphql/config", () => ({
  getApiOrigin: () => "https://chat.example",
}));

import { Avatar } from "../ui/Avatar";
import {
  isOnApiOrigin,
  loadsAsBlob,
  refreshServerMedia,
  resolveServerUrl,
  useServerMedia,
  useServerMediaUrl,
  useServerMediaUrls,
} from "./serverMedia";

/**
 * A successful download as `fetch` answers it. A plain object: Node 22's `Response` cannot read
 * a body made from jsdom's `Blob`.
 */
function okResponse(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(["png"]) } as unknown as Response;
}

type TauriWindow = { __TAURI_INTERNALS__?: unknown };

function setDesktop(desktop: boolean) {
  if (desktop) (window as TauriWindow).__TAURI_INTERNALS__ = {};
  else delete (window as TauriWindow).__TAURI_INTERNALS__;
}

describe("resolveServerUrl", () => {
  it("resolves a server-relative path against the API origin", () => {
    expect(resolveServerUrl("/api/files/avatars/u/avatar.png")).toBe(
      "https://chat.example/api/files/avatars/u/avatar.png",
    );
  });

  it("returns absolute, protocol-relative, blob and data URLs unchanged", () => {
    for (const url of [
      "https://other.example/api/files/avatars/u/avatar.png",
      "//cdn.example/a.png",
      "blob:tauri://localhost/1234",
      "data:image/png;base64,AAAA",
    ]) {
      expect(resolveServerUrl(url)).toBe(url);
    }
  });
});

describe("isOnApiOrigin", () => {
  it("is true only for URLs on the API origin", () => {
    expect(isOnApiOrigin("https://chat.example/api/attachments/a/download")).toBe(true);
    expect(isOnApiOrigin("https://other.example/api/files/x")).toBe(false);
    expect(isOnApiOrigin("blob:tauri://localhost/1234")).toBe(false);
    expect(isOnApiOrigin("not a url")).toBe(false);
  });
});

describe("useServerMedia", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let created: number;
  let revoked: string[];

  beforeEach(() => {
    created = 0;
    revoked = [];
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => `blob:tauri://localhost/${++created}`);
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(() => {
    setDesktop(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the URL as given on the web without downloading it", () => {
    setDesktop(false);
    const { result } = renderHook(() => useServerMediaUrl("/api/files/avatars/web/avatar.png"));
    expect(result.current).toBe("/api/files/avatars/web/avatar.png");
    expect(loadsAsBlob("https://chat.example/api/files/avatars/web/avatar.png")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null without a URL", () => {
    setDesktop(true);
    const { result } = renderHook(() => useServerMediaUrl(null));
    expect(result.current).toBeNull();
  });

  it("downloads a server file on the desktop with the session and shows a blob URL", async () => {
    setDesktop(true);
    const { result } = renderHook(() => useServerMediaUrl("/api/files/avatars/d1/avatar.png"));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("blob:tauri://localhost/1"));
    expect(fetchMock).toHaveBeenCalledWith("https://chat.example/api/files/avatars/d1/avatar.png", {
      credentials: "include",
    });
  });

  it("leaves an absolute URL of another origin to load directly on the desktop", () => {
    setDesktop(true);
    const url = "https://other.example/api/files/avatars/x/avatar.png";
    const { result } = renderHook(() => useServerMediaUrl(url));
    expect(result.current).toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads one file once for every element showing it", async () => {
    setDesktop(true);
    const url = "/api/files/avatars/shared/avatar.png";
    const first = renderHook(() => useServerMediaUrl(url));
    const second = renderHook(() => useServerMediaUrl(url));
    await waitFor(() => expect(first.result.current).toBe("blob:tauri://localhost/1"));
    await waitFor(() => expect(second.result.current).toBe("blob:tauri://localhost/1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed download", async () => {
    setDesktop(true);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useServerMedia("/api/files/avatars/gone/avatar.png"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.src).toBeNull();
  });

  it("waits while not enabled", async () => {
    setDesktop(true);
    const url = "https://chat.example/api/attachments/big/download";
    const { result, rerender } = renderHook(({ on }) => useServerMedia(url, on), {
      initialProps: { on: false },
    });
    expect(result.current).toEqual({ src: null, failed: false });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current.src).toBe("blob:tauri://localhost/1"));
  });

  it("revokes the object URL a while after the last element unmounts", async () => {
    setDesktop(true);
    const { result, unmount } = renderHook(() =>
      useServerMediaUrl("/api/files/avatars/gc/avatar.png"),
    );
    await waitFor(() => expect(result.current).toBe("blob:tauri://localhost/1"));
    vi.useFakeTimers();
    unmount();
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(revoked).toEqual(["blob:tauri://localhost/1"]);
  });

  it("downloads a replaced file again after a refresh", async () => {
    setDesktop(true);
    const url = "/api/files/avatars/new/avatar.png";
    const { result } = renderHook(() => useServerMediaUrl(url));
    await waitFor(() => expect(result.current).toBe("blob:tauri://localhost/1"));
    act(() => refreshServerMedia(url));
    await waitFor(() => expect(result.current).toBe("blob:tauri://localhost/2"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useServerMediaUrls", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let created: number;
  let revoked: string[];

  beforeEach(() => {
    created = 0;
    revoked = [];
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => `blob:tauri://localhost/list-${++created}`);
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(() => {
    setDesktop(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns every URL as given on the web without downloading", () => {
    setDesktop(false);
    const { result } = renderHook(() => useServerMediaUrls(["/api/emoji/a", "/api/emoji/b"]));
    expect(result.current.get("/api/emoji/a")).toBe("/api/emoji/a");
    expect(result.current.get("/api/emoji/b")).toBe("/api/emoji/b");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives each downloaded file's object URL on the desktop, and leaves out a failed one", async () => {
    setDesktop(true);
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/fail") ? ({ ok: false } as Response) : okResponse(),
    );
    const { result } = renderHook(() => useServerMediaUrls(["/api/emoji/ok", "/api/emoji/fail"]));
    await waitFor(() => expect(result.current.get("/api/emoji/ok")).toMatch(/^blob:/));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.has("/api/emoji/fail")).toBe(false);
  });

  it("releases the downloads when it unmounts", async () => {
    setDesktop(true);
    const { result, unmount } = renderHook(() => useServerMediaUrls(["/api/emoji/gc"]));
    await waitFor(() => expect(result.current.get("/api/emoji/gc")).toMatch(/^blob:/));
    vi.useFakeTimers();
    unmount();
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.current.get("/api/emoji/gc"));
  });
});

describe("Avatar with a server avatar", () => {
  afterEach(() => {
    setDesktop(false);
    vi.unstubAllGlobals();
  });

  it("shows a server-relative avatar from the page's server on the web", () => {
    render(<Avatar name="Alice" userId="u1" url="/api/files/avatars/u1/avatar.png" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/files/avatars/u1/avatar.png");
  });

  it("shows the downloaded copy on the desktop", async () => {
    setDesktop(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse()),
    );
    URL.createObjectURL = vi.fn(() => "blob:tauri://localhost/avatar");
    render(<Avatar name="Alice" userId="u2" url="/api/files/avatars/u2/avatar.png" />);
    expect(screen.getByText("A")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("src", "blob:tauri://localhost/avatar"),
    );
  });

  it("falls back to the initial when the image does not load", () => {
    render(<Avatar name="Bob" userId="u3" url="https://chat.example/missing.png" />);
    act(() => {
      screen.getByRole("img").dispatchEvent(new Event("error"));
    });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});
