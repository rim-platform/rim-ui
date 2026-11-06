import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEdgeStore } from "../../../core/graphql/edgeRefusals";
import { HealthIndicator } from "./HealthIndicator";

const health = vi.hoisted(() => ({ value: { isSuccess: false, isError: false } }));
vi.mock("../../system/api/useHealthCheck", () => ({ useHealthCheck: () => health.value }));

const runtime = vi.hoisted(() => ({ platform: "desktop" }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({ useRuntime: () => runtime }));

const endpoint = vi.hoisted(() => ({ value: "https://rim.example.org/api" }));
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => endpoint.value,
  endpointHost: (e: string) => new URL(e).host,
}));

describe("HealthIndicator", () => {
  it("names the server and says it is reachable", () => {
    health.value = { isSuccess: true, isError: false };
    render(<HealthIndicator />);
    expect(screen.getByText("rim.example.org")).toBeInTheDocument();
    expect(screen.getByText("reachable")).toBeInTheDocument();
  });

  it("says it is connecting before the server answers", () => {
    health.value = { isSuccess: false, isError: false };
    render(<HealthIndicator />);
    expect(screen.getByText("connecting...")).toBeInTheDocument();
  });

  it("shows a bar that names the server and points to another one when it does not answer", () => {
    health.value = { isSuccess: false, isError: true };
    render(<HealthIndicator />);
    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent(
      "Can't reach rim.example.org. Check your connection, or use another server.",
    );
  });

  it("points to another server only where the app can move to one", () => {
    health.value = { isSuccess: false, isError: true };
    runtime.platform = "web";
    try {
      render(<HealthIndicator />);
      const bar = screen.getByRole("status");
      expect(bar).toHaveTextContent("Can't reach rim.example.org. Check your connection.");
      expect(bar).not.toHaveTextContent("another server");
    } finally {
      runtime.platform = "desktop";
    }
  });

  it("says only that the server is reachable where no address is known", () => {
    health.value = { isSuccess: true, isError: false };
    endpoint.value = "";
    try {
      render(<HealthIndicator />);
      expect(screen.getByText("Server reachable")).toBeInTheDocument();
    } finally {
      endpoint.value = "https://rim.example.org/api";
    }
  });

  it("says the address is blocked rather than unreachable", () => {
    health.value = { isSuccess: false, isError: true };
    useEdgeStore.setState({ blocked: true });
    try {
      render(<HealthIndicator />);
      expect(screen.getByText("address blocked")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      useEdgeStore.setState({ blocked: false });
    }
  });
});
