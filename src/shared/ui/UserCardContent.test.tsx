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

  it("explains a former membership and offers no direct message action", () => {
    render(<UserCardContent {...defaultProps} isFormerMember onSendDm={vi.fn()} />);
    expect(screen.getByText("Not a member of this workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send DM" })).not.toBeInTheDocument();
  });

  it("shows a ban reason only when supplied and offers no direct message action", () => {
    render(
      <UserCardContent
        {...defaultProps}
        isFormerMember
        ban={{ banned: true, banReason: "Repeated spam" }}
        onSendDm={vi.fn()}
      />,
    );
    expect(screen.getByText("Banned from this workspace")).toBeInTheDocument();
    expect(screen.getByText("Reason: Repeated spam")).toBeInTheDocument();
    expect(screen.queryByText("Not a member of this workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send DM" })).not.toBeInTheDocument();
  });

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

  it("offers Block… when the card's block action names one, and runs it", () => {
    const block = vi.fn();
    render(<UserCardContent {...defaultProps} blockAction={() => block} />);
    fireEvent.click(screen.getByRole("button", { name: "Block…" }));
    expect(block).toHaveBeenCalledTimes(1);
  });

  it("offers no Block… on the viewer's own card or without a block action", () => {
    const { rerender } = render(
      <UserCardContent {...defaultProps} isCurrentUser blockAction={() => vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Block…" })).not.toBeInTheDocument();
    rerender(<UserCardContent {...defaultProps} blockAction={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Block…" })).not.toBeInTheDocument();
    rerender(<UserCardContent {...defaultProps} />);
    expect(screen.queryByRole("button", { name: "Block…" })).not.toBeInTheDocument();
  });
});

describe("UserCardContent for a bot", () => {
  const bot = {
    runBy: "the Halden Studio team",
    readsGoTo: "our own server, with a local model",
    addedByName: "Ivana",
  };
  const props = {
    userId: "bot-1",
    username: "helper",
    displayName: "Helper",
    isBot: true,
    bot,
    role: "GUEST",
    statusText: "Online and busy",
    presenceStatus: "ONLINE" as const,
  };

  it("shows what the person who added it says, and that RIM cannot check it", () => {
    render(<UserCardContent {...props} />);
    expect(screen.getByTestId("bot-badge")).toBeInTheDocument();
    expect(screen.getByText("Who runs it")).toBeInTheDocument();
    expect(screen.getByText("the Halden Studio team")).toBeInTheDocument();
    expect(screen.getByText("Where what it reads goes")).toBeInTheDocument();
    expect(screen.getByText("our own server, with a local model")).toBeInTheDocument();
    expect(screen.getByText("Added by")).toBeInTheDocument();
    expect(screen.getByText("Ivana")).toBeInTheDocument();
    expect(
      screen.getByText("This is what the person who added it says. RIM can't check it."),
    ).toBeInTheDocument();
  });

  it("names nobody when the person who added it is gone", () => {
    render(<UserCardContent {...props} bot={{ ...bot, addedByName: null }} />);
    expect(screen.getByText("someone no longer here")).toBeInTheDocument();
  });

  it("shows markup in a statement as plain text", () => {
    render(<UserCardContent {...props} bot={{ ...bot, runBy: "<b>them</b>" }} />);
    expect(screen.getByText("<b>them</b>")).toBeInTheDocument();
  });

  it("offers no message, copy, block, status line or role", () => {
    render(
      <UserCardContent
        {...props}
        onSendDm={vi.fn()}
        blockAction={() => vi.fn()}
        handle={{ shown: "@helper", copied: "@helper" }}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Online and busy")).not.toBeInTheDocument();
    expect(screen.queryByText(/Role:/)).not.toBeInTheDocument();
    expect(screen.queryByText("@helper")).not.toBeInTheDocument();
  });

  it("shows a person none of it", () => {
    render(<UserCardContent userId="u" username="person" statusText="Hi" />);
    expect(screen.queryByTestId("bot-badge")).not.toBeInTheDocument();
    expect(screen.queryByText("Who runs it")).not.toBeInTheDocument();
  });
});
