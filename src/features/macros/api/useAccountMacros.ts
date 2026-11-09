import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import type { UserCommand, UserCommandStep } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fetchServerInfo, type KnownServerInfo } from "../../updater/api/serverInfoApi";
import { ACCOUNT_MACROS, hasCapability } from "../../updater/api/serverCapabilities";
import type { CommandDefinition } from "../../commands/types";

/** One step of a macro: the command it runs, its fixed arguments and those it asks for. */
export type AccountMacroStep = Pick<UserCommandStep, "commandId" | "args" | "ask">;

/** One of the person's macros as the home server keeps it, enabled or not. */
export type AccountMacro = Pick<
  UserCommand,
  "id" | "title" | "description" | "isEnabled" | "aiCallable" | "nlDescription" | "intentSamples"
> & { steps: AccountMacroStep[] };

/** A command a macro step may name, with whether the AI agent may run it. */
export type MacroStepCommand = CommandDefinition & { aiCallable: boolean };

const AccountMacrosDocument = gql`
  query AccountMacros {
    userCommands {
      id
      title
      description
      isEnabled
      aiCallable
      nlDescription
      intentSamples
      steps {
        commandId
        args
        ask
      }
    }
  }
`;

const MacroStepCommandsDocument = gql`
  query MacroStepCommands {
    macroStepCommands {
      id
      title
      description
      category
      sourceKind
      executionTarget
      requiredContext
      requiredCapabilities
      visibleInPalette
      visibleInContextMenus
      keybindCapable
      dangerous
      sensitivity
      aiCallable
      arguments {
        name
        title
        description
        argumentType
        required
        defaultValue
        allowedValues
      }
    }
  }
`;

/** How long the macros read from the home server are used before they are read again. */
const MACROS_STALE_MS = 30_000;

/**
 * Whether the home server keeps the person's macros as their own commands, as its cached
 * server info says; false while that is unknown.
 */
export function accountMacrosOn(): boolean {
  return hasCapability(
    queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo),
    ACCOUNT_MACROS,
  );
}

/**
 * Whether the home server keeps the person's macros as their own commands, as its server info
 * says once read; kept current, and never reading the server info itself.
 */
export function useAccountMacrosOn(): boolean {
  const { data } = useQuery(
    {
      queryKey: queryKeys.serverInfo,
      queryFn: fetchServerInfo,
      enabled: false,
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    },
    queryClient,
  );
  return hasCapability(data, ACCOUNT_MACROS);
}

async function requestAccountMacros(): Promise<AccountMacro[]> {
  const res = await graphqlClient.request<{ userCommands: AccountMacro[] }>(AccountMacrosDocument);
  return res.userCommands;
}

async function requestMacroStepCommands(): Promise<MacroStepCommand[]> {
  const res = await graphqlClient.request<{ macroStepCommands: MacroStepCommand[] }>(
    MacroStepCommandsDocument,
  );
  return res.macroStepCommands;
}

/**
 * The person's macros, enabled or not, read from the home server while it lists
 * {@link ACCOUNT_MACROS}.
 */
export function useAccountMacros() {
  const on = useAccountMacrosOn();
  return useQuery(
    {
      queryKey: queryKeys.accountMacros,
      enabled: on,
      staleTime: MACROS_STALE_MS,
      queryFn: requestAccountMacros,
    },
    queryClient,
  );
}

/** The person's macros, from the cache when read in the last half minute, else from the server. */
export function fetchAccountMacros(): Promise<AccountMacro[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.accountMacros,
    staleTime: MACROS_STALE_MS,
    queryFn: requestAccountMacros,
  });
}

/** The person's macros, read from the home server now. */
export function refetchAccountMacros(): Promise<AccountMacro[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.accountMacros,
    staleTime: 0,
    queryFn: requestAccountMacros,
  });
}

/**
 * Every built-in and app command a macro step may name, read once from the home server while it
 * lists {@link ACCOUNT_MACROS}.
 */
export function useMacroStepCommands() {
  const on = useAccountMacrosOn();
  return useQuery(
    {
      queryKey: queryKeys.macroStepCommands,
      enabled: on,
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      queryFn: requestMacroStepCommands,
    },
    queryClient,
  );
}

/** The commands a macro step may name, from the cache, read from the server the first time. */
export function fetchMacroStepCommands(): Promise<MacroStepCommand[]> {
  return queryClient.ensureQueryData({
    queryKey: queryKeys.macroStepCommands,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: requestMacroStepCommands,
  });
}
