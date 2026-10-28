import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/utils";
import { MessageHeader } from "./MessageHeader";
import type { MessageAuthorView } from "./types";

function header(author: Partial<MessageAuthorView>) {
  return (
    <MessageHeader
      authorId="u-1"
      sentAt="2026-10-10T10:00:00Z"
      author={{ name: "Ada", isCurrentUser: false, ...author }}
    />
  );
}

describe("MessageHeader role badge", () => {
  it.each(["OWNER", "MODERATOR", "GUEST"])("marks a %s author", (role) => {
    renderWithProviders(header({ role }));
    expect(screen.getByTestId("role-badge")).toBeInTheDocument();
  });

  it.each(["MEMBER", undefined])("does not mark a %s author", (role) => {
    renderWithProviders(header({ role }));
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
  });

  it("does not mark a former member", () => {
    renderWithProviders(header({ role: "OWNER", isFormerMember: true }));
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
  });

  it("does not mark a banned author", () => {
    renderWithProviders(header({ role: "OWNER", ban: { banned: true } }));
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
  });

  it("does not mark anyone in the direct space, and shows the handle of the other person", () => {
    const handle = { shown: "@ada:rim-platform.org", copied: "@ada:rim-platform.org" };
    const { rerender } = renderWithProviders(
      header({ role: "OWNER", inDirectSpace: true, handle }),
    );
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
    expect(screen.getByText("@ada:rim-platform.org")).toBeInTheDocument();

    rerender(header({ inDirectSpace: true, handle, isCurrentUser: true }));
    expect(screen.queryByText("@ada:rim-platform.org")).not.toBeInTheDocument();
  });

  it("shows no handle inline in a workspace", () => {
    const handle = { shown: "@ada", copied: "@ada:rim-platform.org" };
    renderWithProviders(header({ handle }));
    expect(screen.queryByText("@ada")).not.toBeInTheDocument();
  });
});
