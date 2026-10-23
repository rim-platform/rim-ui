import type { User } from "../../core/graphql/generated/schema-types";

export type AuthorBan = Partial<Pick<User, "banned" | "bannedUntil" | "banReason">>;

export function activeBan(author: AuthorBan | null | undefined): boolean {
  return (
    author?.banned === true && (!author.bannedUntil || Date.parse(author.bannedUntil) > Date.now())
  );
}

export function banLabel(author: AuthorBan | null | undefined): string {
  if (!activeBan(author)) return "";
  return author?.bannedUntil
    ? `banned until ${new Date(author.bannedUntil).toLocaleString()}`
    : "banned";
}
