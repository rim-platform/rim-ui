import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { useConnectionStore } from "../../system/state/useConnectionStore";
import {
  ConnectionBanner,
  TOO_MANY_CONNECTIONS_MESSAGE,
} from "../../system/components/ConnectionBanner";
import { useOfflineStore } from "../state/useOfflineStore";
import { OfflineBanner } from "./OfflineBanner";

function Banners() {
  return (
    <>
      <OfflineBanner />
      <ConnectionBanner />
    </>
  );
}

describe("OfflineBanner", () => {
  afterEach(() => {
    useOfflineStore.setState({ offline: false });
    useConnectionStore.setState({ status: "connecting" });
    useEdgeStore.setState({ blocked: false, tooManyConnections: false });
  });

  it("shows only while the app runs offline, instead of the reconnecting banner", () => {
    useOfflineStore.setState({ offline: true });
    useConnectionStore.setState({ status: "disconnected" });
    render(<Banners />);

    expect(screen.getByTestId("offline-banner")).toHaveTextContent("Offline");
    expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument();

    act(() => useOfflineStore.getState().setOffline(false));
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
    expect(screen.getByText(/Connection lost/)).toBeInTheDocument();
  });

  it("says the address is blocked while offline, rather than a generic offline", () => {
    useOfflineStore.setState({ offline: true });
    useEdgeStore.setState({ blocked: true });
    render(<Banners />);

    expect(screen.getByTestId("offline-banner")).toHaveTextContent(
      "This address is blocked on this server",
    );
    expect(screen.getByTestId("offline-banner")).not.toHaveTextContent("Offline.");
  });
});

describe("ConnectionBanner", () => {
  afterEach(() => {
    useConnectionStore.setState({ status: "connecting" });
    useEdgeStore.setState({ blocked: false, tooManyConnections: false });
  });

  it("says the address is blocked instead of reconnecting", () => {
    useConnectionStore.setState({ status: "disconnected" });
    useEdgeStore.setState({ blocked: true });
    render(<ConnectionBanner />);

    expect(screen.getByRole("alert")).toHaveTextContent("This address is blocked on this server");
    expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument();
  });

  it("says Reconnected for a while once a lost connection is back, and nothing on the first connect", () => {
    vi.useFakeTimers();
    try {
      render(<ConnectionBanner />);
      act(() => useConnectionStore.setState({ status: "connected" }));
      expect(screen.queryByText("Reconnected")).not.toBeInTheDocument();

      act(() => useConnectionStore.setState({ status: "disconnected" }));
      expect(screen.getByText("Connection lost. Reconnecting...")).toBeInTheDocument();
      act(() => useConnectionStore.setState({ status: "connected" }));
      expect(screen.getByText("Reconnected")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByText("Reconnected")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says there are too many connections while the upgrade is refused for them", () => {
    useConnectionStore.setState({ status: "disconnected" });
    useEdgeStore.setState({ tooManyConnections: true });
    render(<ConnectionBanner />);

    expect(screen.getByRole("status")).toHaveTextContent(TOO_MANY_CONNECTIONS_MESSAGE);
    act(() => useEdgeStore.setState({ tooManyConnections: false }));
    expect(screen.getByRole("status")).toHaveTextContent("Connection lost. Reconnecting...");
  });
});
