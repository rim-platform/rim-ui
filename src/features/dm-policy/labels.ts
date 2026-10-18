import {
  DmFloorSourceKind,
  DmInbound,
  DmMembers,
  DmOutbound,
  DmOutside,
  DmOutsideFloor,
  type DmFloorSource,
} from "../../core/graphql/generated/schema-types";

/** One value of a DM setting as the settings pages show it. */
export interface DmChoice<T extends string> {
  value: T;
  label: string;
  description: string;
}

/** A person's choice for DMs from people outside their workspaces. */
export const OUTSIDE_CHOICES: DmChoice<DmOutside>[] = [
  {
    value: DmOutside.REQUESTS,
    label: "Requests",
    description: "Their first message waits in your requests until you accept it.",
  },
  {
    value: DmOutside.NONE,
    label: "Nobody",
    description: "Nobody outside your workspaces can start a DM with you.",
  },
];

/** A person's choice, or a workspace's default, for DMs from fellow members. */
export const MEMBER_CHOICES: DmChoice<DmMembers>[] = [
  {
    value: DmMembers.DIRECT,
    label: "Direct",
    description: "A member's DM goes straight to your conversations.",
  },
  {
    value: DmMembers.REQUESTS,
    label: "Requests",
    description: "A member's first message waits in your requests until you accept it.",
  },
];

/** A workspace's floor for DMs to its members from people outside their workspaces. */
export const FLOOR_CHOICES: DmChoice<DmOutsideFloor>[] = [
  {
    value: DmOutsideFloor.NONE,
    label: "No floor",
    description: "Each member decides who outside their workspaces may message them.",
  },
  {
    value: DmOutsideFloor.REQUESTS,
    label: "At least a request",
    description: "A DM from outside reaches a member as a request at most, never directly.",
  },
  {
    value: DmOutsideFloor.CLOSED,
    label: "Closed",
    description: "Members get no DMs from people outside their workspaces.",
  },
];

/** The workspace default for members' DMs, as the workspace's Owner sets it. */
export const MEMBER_DEFAULT_CHOICES: DmChoice<DmMembers>[] = [
  {
    value: DmMembers.DIRECT,
    label: "Direct",
    description: "A DM between members goes straight to the recipient's conversations.",
  },
  {
    value: DmMembers.REQUESTS,
    label: "Requests",
    description: "A DM between members waits in the recipient's requests until they accept it.",
  },
];

/** The operator's floor for DMs from other servers and from outside a shared workspace. */
export const INBOUND_CHOICES: DmChoice<DmInbound>[] = [
  {
    value: DmInbound.OPEN,
    label: "Open",
    description: "No floor: each person's own choice applies.",
  },
  {
    value: DmInbound.REQUESTS,
    label: "Requests",
    description: "A first message from outside a shared workspace is a request.",
  },
  {
    value: DmInbound.PARTNERS,
    label: "Partners only",
    description: "Only people here and on the partner servers can start a DM, as a request.",
  },
  {
    value: DmInbound.NONE,
    label: "Closed",
    description: "Nobody outside a shared workspace can start a DM with people here.",
  },
];

/** The operator's rule for DMs people here start with people on other servers. */
export const OUTBOUND_CHOICES: DmChoice<DmOutbound>[] = [
  {
    value: DmOutbound.ALLOWED,
    label: "Allowed",
    description: "People here can start DMs with people on any server.",
  },
  {
    value: DmOutbound.PARTNERS,
    label: "Partners only",
    description: "People here can start DMs only with people on the partner servers.",
  },
  {
    value: DmOutbound.NONE,
    label: "Not allowed",
    description: "People here cannot start DMs with people on other servers.",
  },
];

/** The choice of `choices` holding `value`; the first when none does. */
export function choiceOf<T extends string>(choices: DmChoice<T>[], value: T): DmChoice<T> {
  return choices.find((c) => c.value === value) ?? choices[0];
}

/** Where a floor that refuses DMs from outside comes from, in the settings' words. */
export function floorSourceText(source: Pick<DmFloorSource, "kind" | "workspaceName">): string {
  if (source.kind === DmFloorSourceKind.OPERATOR) return "Set by your server's operator";
  return source.workspaceName
    ? `Set by the workspace ${source.workspaceName}`
    : "Set by one of your workspaces";
}
