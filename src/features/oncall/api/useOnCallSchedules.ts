import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import type {
  OnCallScheduleGql,
  RotationLayerGql,
  OnCallOverrideGql,
  RotationKindInputGql,
} from "../../../core/graphql/generated/schema-types";

export type OnCallSchedule = OnCallScheduleGql;
export type RotationLayer = RotationLayerGql;
export type OnCallOverride = OnCallOverrideGql;

const ROTATION_LAYER_FIELDS = gql`
  fragment RotationLayerFields on RotationLayerGql {
    id
    scheduleId
    name
    priority
    kind
    handoffTime
    handoffWeekday
    intervalSeconds
    anchorAt
    createdAt
    participants
  }
`;

const SCHEDULE_FIELDS = gql`
  fragment OnCallScheduleFields on OnCallScheduleGql {
    id
    serverId
    name
    timezone
    createdBy
    createdAt
    updatedAt
    rotationLayers {
      ...RotationLayerFields
    }
  }
  ${ROTATION_LAYER_FIELDS}
`;

const OVERRIDE_FIELDS = gql`
  fragment OnCallOverrideFields on OnCallOverrideGql {
    id
    scheduleId
    userId
    startAt
    endAt
    createdBy
  }
`;

const ON_CALL_SCHEDULES_QUERY = gql`
  query OnCallSchedules($serverId: ID!) {
    onCallSchedules(serverId: $serverId) {
      ...OnCallScheduleFields
    }
  }
  ${SCHEDULE_FIELDS}
`;

/**
 * Lists a server's on-call schedules (Track C1), each with its `rotationLayers` (and
 * their `participants`) nested — ordered `priority DESC, created_at ASC` server-side.
 * Any workspace member may read. This lets {@link ScheduleEditor} load and edit an
 * existing schedule's rotations, not just create new ones.
 */
export function useOnCallSchedules(serverId?: string) {
  return useQuery({
    queryKey: queryKeys.onCallSchedules(serverId),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await graphqlClient.request<{ onCallSchedules: OnCallSchedule[] }>(
        ON_CALL_SCHEDULES_QUERY,
        { serverId: serverId! },
      );
      return res.onCallSchedules;
    },
  });
}

const CREATE_SCHEDULE_MUTATION = gql`
  mutation CreateOnCallSchedule($serverId: ID!, $name: String!, $timezone: String!) {
    createOnCallSchedule(serverId: $serverId, name: $name, timezone: $timezone) {
      ...OnCallScheduleFields
    }
  }
  ${SCHEDULE_FIELDS}
`;

/** Creates an on-call schedule. Owner/Moderator-gated on the backend; invalidates the schedule list. */
export function useCreateOnCallSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; name: string; timezone: string }) =>
      graphqlClient
        .request<{ createOnCallSchedule: OnCallSchedule }>(CREATE_SCHEDULE_MUTATION, vars)
        .then((res) => res.createOnCallSchedule),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const UPDATE_SCHEDULE_MUTATION = gql`
  mutation UpdateOnCallSchedule($scheduleId: ID!, $name: String, $timezone: String) {
    updateOnCallSchedule(scheduleId: $scheduleId, name: $name, timezone: $timezone) {
      ...OnCallScheduleFields
    }
  }
  ${SCHEDULE_FIELDS}
`;

/** Updates a schedule's name/timezone. `serverId` is caller-supplied for cache invalidation only. */
export function useUpdateOnCallSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      serverId: string;
      scheduleId: string;
      name?: string;
      timezone?: string;
    }) =>
      graphqlClient
        .request<{ updateOnCallSchedule: OnCallSchedule }>(UPDATE_SCHEDULE_MUTATION, {
          scheduleId: vars.scheduleId,
          name: vars.name,
          timezone: vars.timezone,
        })
        .then((res) => res.updateOnCallSchedule),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const DELETE_SCHEDULE_MUTATION = gql`
  mutation DeleteOnCallSchedule($scheduleId: ID!) {
    deleteOnCallSchedule(scheduleId: $scheduleId)
  }
`;

/** Deletes a schedule (cascades to layers/participants/overrides server-side). */
export function useDeleteOnCallSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; scheduleId: string }) =>
      graphqlClient.request<{ deleteOnCallSchedule: boolean }>(DELETE_SCHEDULE_MUTATION, {
        scheduleId: vars.scheduleId,
      }),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const ADD_ROTATION_LAYER_MUTATION = gql`
  mutation AddRotationLayer(
    $scheduleId: ID!
    $name: String!
    $priority: Int!
    $kind: RotationKindInputGql!
    $anchorAt: DateTime!
  ) {
    addRotationLayer(
      scheduleId: $scheduleId
      name: $name
      priority: $priority
      kind: $kind
      anchorAt: $anchorAt
    ) {
      ...RotationLayerFields
    }
  }
  ${ROTATION_LAYER_FIELDS}
`;

export interface AddRotationLayerVars {
  /** Caller-supplied for cache invalidation only — not sent to the mutation itself. */
  serverId: string;
  scheduleId: string;
  name: string;
  priority: number;
  kind: RotationKindInputGql;
  anchorAt: string;
}

/** Adds a rotation layer to a schedule. Invalidates the schedule list (which now nests
 * `rotationLayers`) for the layer's server. */
export function useAddRotationLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AddRotationLayerVars) =>
      graphqlClient
        .request<{ addRotationLayer: RotationLayer }>(ADD_ROTATION_LAYER_MUTATION, {
          scheduleId: vars.scheduleId,
          name: vars.name,
          priority: vars.priority,
          kind: vars.kind,
          anchorAt: vars.anchorAt,
        })
        .then((res) => res.addRotationLayer),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const UPDATE_ROTATION_LAYER_MUTATION = gql`
  mutation UpdateRotationLayer(
    $layerId: ID!
    $name: String
    $priority: Int
    $kind: RotationKindInputGql
    $anchorAt: DateTime
  ) {
    updateRotationLayer(
      layerId: $layerId
      name: $name
      priority: $priority
      kind: $kind
      anchorAt: $anchorAt
    ) {
      ...RotationLayerFields
    }
  }
  ${ROTATION_LAYER_FIELDS}
`;

export interface UpdateRotationLayerVars {
  /** Caller-supplied for cache invalidation only — not sent to the mutation itself. */
  serverId: string;
  layerId: string;
  name?: string;
  priority?: number;
  kind?: RotationKindInputGql;
  anchorAt?: string;
}

export function useUpdateRotationLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateRotationLayerVars) =>
      graphqlClient
        .request<{ updateRotationLayer: RotationLayer }>(UPDATE_ROTATION_LAYER_MUTATION, {
          layerId: vars.layerId,
          name: vars.name,
          priority: vars.priority,
          kind: vars.kind,
          anchorAt: vars.anchorAt,
        })
        .then((res) => res.updateRotationLayer),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const REMOVE_ROTATION_LAYER_MUTATION = gql`
  mutation RemoveRotationLayer($layerId: ID!) {
    removeRotationLayer(layerId: $layerId)
  }
`;

export function useRemoveRotationLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; layerId: string }) =>
      graphqlClient.request<{ removeRotationLayer: boolean }>(REMOVE_ROTATION_LAYER_MUTATION, {
        layerId: vars.layerId,
      }),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const SET_ROTATION_PARTICIPANTS_MUTATION = gql`
  mutation SetRotationParticipants($layerId: ID!, $userIds: [ID!]!) {
    setRotationParticipants(layerId: $layerId, userIds: $userIds) {
      ...RotationLayerFields
    }
  }
  ${ROTATION_LAYER_FIELDS}
`;

/** Replaces a layer's full ordered participant list. `userIds[0]` becomes the first shift.
 * `serverId` is caller-supplied for cache invalidation only. */
export function useSetRotationParticipants() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: string; layerId: string; userIds: string[] }) =>
      graphqlClient
        .request<{ setRotationParticipants: RotationLayer }>(SET_ROTATION_PARTICIPANTS_MUTATION, {
          layerId: vars.layerId,
          userIds: vars.userIds,
        })
        .then((res) => res.setRotationParticipants),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.onCallSchedules(vars.serverId) });
    },
  });
}

const CREATE_OVERRIDE_MUTATION = gql`
  mutation CreateOnCallOverride(
    $scheduleId: ID!
    $userId: ID!
    $startAt: DateTime!
    $endAt: DateTime!
  ) {
    createOnCallOverride(
      scheduleId: $scheduleId
      userId: $userId
      startAt: $startAt
      endAt: $endAt
    ) {
      ...OnCallOverrideFields
    }
  }
  ${OVERRIDE_FIELDS}
`;

export interface CreateOnCallOverrideVars {
  scheduleId: string;
  userId: string;
  startAt: string;
  endAt: string;
}

/** Creates a one-off override. Invalidates the schedule's `onCallShifts`/`serverOnCall`/`whoIsOnCall`. */
export function useCreateOnCallOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateOnCallOverrideVars) =>
      graphqlClient
        .request<{ createOnCallOverride: OnCallOverride }>(CREATE_OVERRIDE_MUTATION, vars)
        .then((res) => res.createOnCallOverride),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: ["onCallShifts", vars.scheduleId] });
      qc.invalidateQueries({ queryKey: ["whoIsOnCall", vars.scheduleId] });
      // No serverId in scope here (createOnCallOverride only takes scheduleId/userId/
      // startAt/endAt) — invalidate the serverOnCall root broadly rather than guess a key.
      qc.invalidateQueries({ queryKey: ["serverOnCall"] });
    },
  });
}

const DELETE_OVERRIDE_MUTATION = gql`
  mutation DeleteOnCallOverride($overrideId: ID!) {
    deleteOnCallOverride(overrideId: $overrideId)
  }
`;

export function useDeleteOnCallOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { overrideId: string; scheduleId: string }) =>
      graphqlClient.request<{ deleteOnCallOverride: boolean }>(DELETE_OVERRIDE_MUTATION, {
        overrideId: vars.overrideId,
      }),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: ["onCallShifts", vars.scheduleId] });
      qc.invalidateQueries({ queryKey: ["whoIsOnCall", vars.scheduleId] });
    },
  });
}
