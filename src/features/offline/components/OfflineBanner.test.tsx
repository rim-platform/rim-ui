import { describe, it, expect, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { useConnectionStore } from "../../system/state/useConnectionStore";
import { ConnectionBanner } from "../../system/components/ConnectionBanner";
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
});
