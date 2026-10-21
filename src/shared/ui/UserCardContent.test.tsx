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

  it("shows the handle as it reads and copies it whole", () => {
    render(
      <UserCardContent
        {...defaultProps}
        handle={{ shown: "@ada:elsewhere.example", copied: "@ada:elsewhere.example" }}
      />,
    );
    expect(screen.getByText("@ada:elsewhere.example")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Copy @ada:elsewhere.example/));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("@ada:elsewhere.example");
  });

  it("copies a local person's whole handle while showing @username", () => {
    render(
      <UserCardContent
        {...defaultProps}
        handle={{ shown: "@kuba", copied: "@kuba:rim.example" }}
      />,
    );
    fireEvent.click(screen.getByText("Copy @kuba"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("@kuba:rim.example");
  });

  it("shows no r_ name and offers no copy for a person whose handle is not known", () => {
    render(<UserCardContent userId="user-2" username="r_abcdef" displayName="Ada" />);
    expect(screen.queryByText(/r_abcdef/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Copy/)).not.toBeInTheDocument();
  });
});
