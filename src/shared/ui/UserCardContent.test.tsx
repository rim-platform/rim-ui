import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserCardContent } from "./UserCardContent";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

describe("UserCardContent", () => {
  const defaultProps = {
    userId: "user-1",
    username: "testuser",
  };

  it("renders username", () => {
    render(<UserCardContent {...defaultProps} />);
    expect(screen.getByText("@testuser")).toBeInTheDocument();
  });

  it("renders displayName when provided", () => {
    render(<UserCardContent {...defaultProps} displayName="Test User" />);
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("falls back to username when displayName is not provided", () => {
    render(<UserCardContent {...defaultProps} />);
    // The resolved display name should be the username
    const heading = screen.getAllByText("testuser");
    expect(heading.length).toBeGreaterThanOrEqual(1);
  });

  it("renders status text when provided", () => {
    render(<UserCardContent {...defaultProps} statusText="In a meeting" />);
    expect(screen.getByText("In a meeting")).toBeInTheDocument();
  });

  it("renders role when provided", () => {
    render(<UserCardContent {...defaultProps} role="ADMIN" />);
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("renders bio when provided", () => {
    render(<UserCardContent {...defaultProps} bio="A developer" />);
    expect(screen.getByText("A developer")).toBeInTheDocument();
  });

  it("shows Edit Status button for current user", () => {
    render(<UserCardContent {...defaultProps} isCurrentUser />);
    expect(screen.getByText("Edit Status")).toBeInTheDocument();
    expect(screen.queryByText("Send DM")).not.toBeInTheDocument();
  });

  it("shows Send DM and Copy buttons for other users", () => {
    const onSendDm = vi.fn();
    render(<UserCardContent {...defaultProps} isCurrentUser={false} onSendDm={onSendDm} />);
    expect(screen.getByText(/Copy @testuser/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Send DM"));
    expect(onSendDm).toHaveBeenCalledOnce();
  });

  it("offers no Send DM without a way to open one", () => {
    render(<UserCardContent {...defaultProps} isCurrentUser={false} />);
    expect(screen.queryByText("Send DM")).not.toBeInTheDocument();
  });

  it("copies username to clipboard on copy button click", () => {
    render(<UserCardContent {...defaultProps} />);
    fireEvent.click(screen.getByText(/Copy @testuser/));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("@testuser");
  });
});
