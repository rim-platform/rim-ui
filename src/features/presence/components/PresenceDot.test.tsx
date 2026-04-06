import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceDot } from "./PresenceDot";
import { usePresenceStore } from "../state/usePresenceStore";

describe("PresenceDot", () => {
  beforeEach(() => {
    usePresenceStore.setState({ presenceMap: {} });
  });

  it("renders with OFFLINE label when user has no presence entry", () => {
    render(<PresenceDot userId="unknown-user" />);
    expect(screen.getByLabelText("Offline")).toBeInTheDocument();
  });

  it("renders with Online label for ONLINE status", () => {
    usePresenceStore.setState({
      presenceMap: { "user-1": "ONLINE" },
    });

    render(<PresenceDot userId="user-1" />);
    expect(screen.getByLabelText("Online")).toBeInTheDocument();
  });

  it("renders with Away label for AWAY status", () => {
    usePresenceStore.setState({
      presenceMap: { "user-1": "AWAY" },
    });

    render(<PresenceDot userId="user-1" />);
    expect(screen.getByLabelText("Away")).toBeInTheDocument();
  });

  it("renders with Offline label for OFFLINE status", () => {
    usePresenceStore.setState({
      presenceMap: { "user-1": "OFFLINE" },
    });

    render(<PresenceDot userId="user-1" />);
    expect(screen.getByLabelText("Offline")).toBeInTheDocument();
  });

  it("renders as a span element", () => {
    const { container } = render(<PresenceDot userId="user-1" />);
    const span = container.querySelector("span");
    expect(span).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<PresenceDot userId="user-1" className="extra-class" />);
    const span = container.querySelector("span");
    expect(span?.className).toContain("extra-class");
  });

  it("uses title attribute for tooltip", () => {
    usePresenceStore.setState({
      presenceMap: { "user-1": "ONLINE" },
    });

    render(<PresenceDot userId="user-1" />);
    const dot = screen.getByTitle("Online");
    expect(dot).toBeInTheDocument();
  });
});
