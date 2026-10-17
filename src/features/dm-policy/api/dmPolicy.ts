/**
 * Who may start a DM: the caller's own choices (`myDmSettings`), a workspace's policy (its
 * floor for DMs from outside and its default for members' DMs), and the mutations that set
 * them. Each is asked on its own, so a server without them fails only here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type {
  DmMembers,
  DmOutside,
  DmOutsideFloor,
  MyDmSettings,
  WorkspaceDmPolicy,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const MY_DM_SETTINGS_FIELDS = `
  outside
  workspaces {
    workspaceId
    members
    memberDefault
  }
  effectiveOutside
  outsideFloorFrom {
    kind
    workspaceId
    workspaceName
  }
`;

const MY_DM_SETTINGS_QUERY = gql`
  query MyDmSettings {
    myDmSettings {
      ${MY_DM_SETTINGS_FIELDS}
    }
  }
`;

const SET_MY_DM_SETTINGS = gql`
  mutation SetMyDmSettings($outside: DmOutside!) {
    setMyDmSettings(outside: $outside) {
      ${MY_DM_SETTINGS_FIELDS}
    }
  }
`;

const SET_MY_WORKSPACE_DM_SETTING = gql`
  mutation SetMyWorkspaceDmSetting($workspaceId: ID!, $members: DmMembers!) {
    setMyWorkspaceDmSetting(workspaceId: $workspaceId, members: $members) {
      ${MY_DM_SETTINGS_FIELDS}
    }
  }
`;

const WORKSPACE_DM_POLICY_QUERY = gql`
  query WorkspaceDmPolicy($serverId: ID!) {
    server(serverId: $serverId) {
      id
      dmOutsideFloor
      dmMemberDefault
    }
  }
`;

const SET_WORKSPACE_DM_POLICY = gql`
  mutation SetWorkspaceDmPolicy(
    $workspaceId: ID!
    $outsideFloor: DmOutsideFloor!
    $memberDefault: DmMembers!
  ) {
    setWorkspaceDmPolicy(
      workspaceId: $workspaceId
      outsideFloor: $outsideFloor
      memberDefault: $memberDefault
    ) {
      workspaceId
      outsideFloor
      memberDefault
    }
  }
`;

/** The caller's DM settings as the server answers them. */
export type MyDmSettingsView = Pick<
  MyDmSettings,
  "outside" | "workspaces" | "effectiveOutside" | "outsideFloorFrom"
>;

/** A workspace's DM policy; both values are null in a direct space. */
export interface WorkspaceDmPolicyView {
  outsideFloor: DmOutsideFloor | null;
  memberDefault: DmMembers | null;
}

export async function fetchMyDmSettings(): Promise<MyDmSettingsView> {
  const res = await graphqlClient.request<{ myDmSettings: MyDmSettingsView }>(MY_DM_SETTINGS_QUERY);
  return res.myDmSettings;
}

/** The caller's choices: what applies to DMs from outside, and per workspace. */
export function useMyDmSettings() {
  return useQuery({
    queryKey: queryKeys.myDmSettings,
    staleTime: 60_000,
    retry: false,
    queryFn: fetchMyDmSettings,
  });
}

/** Sets the caller's choice for DMs from outside their workspaces. */
export function useSetMyDmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (outside: DmOutside) => {
      const res = await graphqlClient.request<{ setMyDmSettings: MyDmSettingsView }>(
        SET_MY_DM_SETTINGS,
        { outside },
      );
      return res.setMyDmSettings;
    },
    onSuccess: (settings) => qc.setQueryData(queryKeys.myDmSettings, settings),
  });
}

/** Sets how DMs from fellow members of one workspace reach the caller. */
export function useSetMyWorkspaceDmSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { workspaceId: string; members: DmMembers }) => {
      const res = await graphqlClient.request<{ setMyWorkspaceDmSetting: MyDmSettingsView }>(
        SET_MY_WORKSPACE_DM_SETTING,
        vars,
      );
      return res.setMyWorkspaceDmSetting;
    },
    onSuccess: (settings) => qc.setQueryData(queryKeys.myDmSettings, settings),
  });
}

/** A workspace's floor for DMs from outside and its default for members' DMs. */
export function useWorkspaceDmPolicy(workspaceId?: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaceDmPolicy(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<WorkspaceDmPolicyView> => {
      const res = await graphqlClient.request<{
        server: { dmOutsideFloor: DmOutsideFloor | null; dmMemberDefault: DmMembers | null };
      }>(WORKSPACE_DM_POLICY_QUERY, { serverId: workspaceId });
      return {
        outsideFloor: res.server.dmOutsideFloor,
        memberDefault: res.server.dmMemberDefault,
      };
    },
  });
}

/** Sets a workspace's DM policy; the server takes it from its Owner only. */
export function useSetWorkspaceDmPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      outsideFloor: DmOutsideFloor;
      memberDefault: DmMembers;
    }) => {
      const res = await graphqlClient.request<{
        setWorkspaceDmPolicy: Pick<
          WorkspaceDmPolicy,
          "workspaceId" | "outsideFloor" | "memberDefault"
        >;
      }>(SET_WORKSPACE_DM_POLICY, vars);
      return res.setWorkspaceDmPolicy;
    },
    onSuccess: (policy) => {
      qc.setQueryData<WorkspaceDmPolicyView>(queryKeys.workspaceDmPolicy(policy.workspaceId), {
        outsideFloor: policy.outsideFloor,
        memberDefault: policy.memberDefault,
      });
      // The members' defaults and any floor in the caller's own settings follow the policy.
      void qc.invalidateQueries({ queryKey: queryKeys.myDmSettings });
    },
  });
}
