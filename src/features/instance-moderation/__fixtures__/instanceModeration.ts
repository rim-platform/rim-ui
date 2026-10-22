import type {
  InstanceAbuseReport,
  InstanceIpBlock,
  InstancePrincipalBlock,
  InstancePrincipalBlockOutcome,
} from "../../../core/graphql/generated/schema-types";

type Handler = (vars: Record<string, unknown>) => unknown;

export const MALLORY = "rimp1_mallory";
export const TROLL = "rimp1_troll";

export function abuseReport(
  id: string,
  overrides: Partial<InstanceAbuseReport> = {},
): InstanceAbuseReport {
  return {
    id,
    reporterUserId: "u-alice",
    reporterUsername: "alice",
    subjectPrincipalId: MALLORY,
    subjectUsername: "mallory",
    subjectServerId: null,
    requestId: null,
    reason: `reason ${id}`,
    createdAt: "2026-10-03T10:00:00Z",
    resolvedAt: null,
    resolved: false,
    ...overrides,
  };
}

export function principalBlock(
  principalId: string,
  overrides: Partial<InstancePrincipalBlock> = {},
): InstancePrincipalBlock {
  return {
    principalId,
    username: null,
    reason: "spam",
    createdAt: "2026-10-04T10:00:00Z",
    ...overrides,
  };
}

export function ipBlock(cidr: string, overrides: Partial<InstanceIpBlock> = {}): InstanceIpBlock {
  return {
    cidr,
    reason: "scraping",
    expiresAt: null,
    createdAt: "2026-10-05T10:00:00Z",
    expired: false,
    ...overrides,
  };
}

/** The outcome of blocking `principalId`, held by the local account `username`. */
export function blockOutcome(
  principalId: string,
  username: string,
  overrides: Partial<InstancePrincipalBlockOutcome> = {},
): InstancePrincipalBlockOutcome {
  return {
    principalId,
    newlyBlocked: true,
    account: { userId: `u-${username}`, username, principalId, createdAt: "2026-09-01T10:00:00Z" },
    reason: "abuse",
    endedSessions: 2,
    ignoredRequests: 0,
    revokedInvites: 1,
    emailBlocked: true,
    invitees: [],
    ...overrides,
  };
}

export interface ModerationWorld {
  operator: boolean;
  reports: InstanceAbuseReport[];
  principalBlocks: InstancePrincipalBlock[];
  ipBlocks: InstanceIpBlock[];
  /** What the next principal block returns; one outcome for the named principal by default. */
  nextBlockOutcomes?: InstancePrincipalBlockOutcome[];
}

/**
 * Request handlers (for `routeRequests`) of a server running the instance moderation queue over
 * `world`, which the mutations change in place as the server would.
 */
export function moderationHandlers(world: ModerationWorld): Record<string, Handler> {
  return {
    "query ViewerInstanceOperator": () => ({
      me: { id: "u-op", instanceOperator: world.operator },
    }),
    "query InstanceReports(": (vars) => {
      const listed = world.reports.filter((r) => !vars.openOnly || !r.resolved);
      const start = vars.after ? listed.findIndex((r) => r.id === vars.after) + 1 : 0;
      const limit = typeof vars.limit === "number" ? vars.limit : listed.length;
      return { instanceReports: listed.slice(start, start + limit) };
    },
    "query InstancePrincipalBlocks": () => ({ instancePrincipalBlocks: world.principalBlocks }),
    "query InstanceIpBlocks": () => ({ instanceIpBlocks: world.ipBlocks }),
    "mutation InstanceResolveReport": (vars) => {
      world.reports = world.reports.map((r) =>
        r.id === vars.id ? { ...r, resolved: true, resolvedAt: "2026-10-06T10:00:00Z" } : r,
      );
      return { instanceResolveReport: world.reports.find((r) => r.id === vars.id) };
    },
    "mutation InstanceBlockPrincipal": (vars) => {
      const principalId = String(vars.principalId);
      const reason = String(vars.reason);
      world.principalBlocks = [
        principalBlock(principalId, { reason, createdAt: "2026-10-06T10:00:00Z" }),
        ...world.principalBlocks.filter((b) => b.principalId !== principalId),
      ];
      return {
        instanceBlockPrincipal: world.nextBlockOutcomes ?? [
          blockOutcome(principalId, "mallory", { reason }),
        ],
      };
    },
    "mutation InstanceUnblockPrincipal": (vars) => {
      const lifted = world.principalBlocks.some((b) => b.principalId === vars.principalId);
      world.principalBlocks = world.principalBlocks.filter(
        (b) => b.principalId !== vars.principalId,
      );
      return { instanceUnblockPrincipal: { lifted, emailUnblocked: lifted } };
    },
    "mutation InstanceBlockIp": (vars) => {
      const cidr = String(vars.cidr);
      const newlyBlocked = !world.ipBlocks.some((b) => b.cidr === cidr);
      const block = ipBlock(cidr, {
        reason: String(vars.reason),
        expiresAt: vars.expiresInDays ? "2026-11-05T10:00:00Z" : null,
      });
      world.ipBlocks = [...world.ipBlocks.filter((b) => b.cidr !== cidr), block];
      return { instanceBlockIp: { block, newlyBlocked } };
    },
    "mutation InstanceUnblockIp": (vars) => {
      const lifted = world.ipBlocks.some((b) => b.cidr === vars.cidr);
      world.ipBlocks = world.ipBlocks.filter((b) => b.cidr !== vars.cidr);
      return { instanceUnblockIp: lifted };
    },
  };
}
