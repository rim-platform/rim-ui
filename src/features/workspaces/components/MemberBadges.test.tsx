import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { RoleBadge, MessageRoleBadge } from "./MemberBadges";

describe("RoleBadge", () => {
  it("puts a crown before the label for an owner", () => {
    render(<RoleBadge role={ServerMemberRoleGql.OWNER} />);
    const badge = screen.getByTestId("role-badge");
    expect(badge).toHaveTextContent("Owner");
    expect(badge).toHaveAttribute("title", "Owner of this workspace");
    expect(badge.querySelector("svg.lucide-crown")).toHaveAttribute("aria-hidden", "true");
  });

  it("puts a shield before the label for a moderator", () => {
    render(<RoleBadge role={ServerMemberRoleGql.MODERATOR} />);
    const badge = screen.getByTestId("role-badge");
    expect(badge).toHaveTextContent("Moderator");
    expect(badge).toHaveAttribute("title", "Moderator of this workspace");
    expect(badge.querySelector("svg.lucide-shield")).not.toBeNull();
  });

  it("shows a guest without an icon and a member not at all", () => {
    const { rerender } = render(<RoleBadge role={ServerMemberRoleGql.GUEST} />);
    expect(screen.getByTestId("role-badge")).toHaveTextContent("Guest");
    expect(screen.getByTestId("role-badge").querySelector("svg")).toBeNull();
    rerender(<RoleBadge role={ServerMemberRoleGql.MEMBER} />);
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
  });
});

describe("MessageRoleBadge", () => {
  it.each([ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR, ServerMemberRoleGql.GUEST])(
    "shows %s",
    (role) => {
      render(<MessageRoleBadge role={role} />);
      expect(screen.getByTestId("role-badge")).toBeInTheDocument();
    },
  );

  it.each([ServerMemberRoleGql.MEMBER, "ADMIN", "", undefined])("shows nothing for %j", (role) => {
    render(<MessageRoleBadge role={role} />);
    expect(screen.queryByTestId("role-badge")).not.toBeInTheDocument();
  });
});
