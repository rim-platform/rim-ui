import "@testing-library/jest-dom/vitest";
import { server } from "./mocks/server";

// jsdom does not implement IntersectionObserver. Multiple surfaces depend on it:
//   - emoji-mart's <Picker> uses it to lazy-render category sections; without
//     a stub the constructor throws an unhandled rejection during
//     componentDidMount.
//   - MessageTimeline / infinite-scroll components use IntersectionObserver
//     to detect scroll-position sentinel visibility for paging.
//   - Future surfaces (viewport-aware lazy loads) will reuse this polyfill.
// Provide a no-op polyfill that satisfies the API surface the libraries read
// — observe/unobserve/disconnect and a takeRecords() returning [] — without
// simulating intersections. Tests that need simulated intersection events
// should construct their own spy wrapper.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: MockIntersectionObserver,
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement Element.scrollIntoView. Keyboard-navigable lists
// (CommandPalette, ThreadPanel, MessageTimeline, SearchOverlay, ...) call it
// to keep the selected/highlighted row visible. Provide a no-op so those
// effects don't throw; tests that care about scroll position should assert
// on it via a spy, not this global stub.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Node.js 22+ exposes a built-in `localStorage` (--localstorage-file) that
// can shadow the jsdom implementation. Ensure a working Storage API is available.
if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.getItem !== "function"
) {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, writable: true });
}

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
