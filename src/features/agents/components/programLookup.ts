/** Looking agent programs up on this computer, and what a profile's program is found as. */

import { useEffect, useState } from "react";

import { findAgentPrograms } from "../acp/agentRunner";
import type { AgentProgramProfile } from "../state/useAgentProgramsStore";

/** Whether `program` is a bare name, which can be looked up. */
export function isBareName(program: string): boolean {
  return program !== "" && !/[\\/]/u.test(program);
}

/**
 * Looks the programs up on the computer's `PATH`.
 *
 * @returns Each bare name and the full path it was found at, or `null`. Empty when the
 *   lookup fails.
 */
export function useFound(names: string[]): Map<string, string | null> {
  const key = names.join("\n");
  const [found, setFound] = useState<Map<string, string | null>>(() => new Map());
  useEffect(() => {
    const wanted = key === "" ? [] : key.split("\n");
    if (wanted.length === 0) return;
    let live = true;
    findAgentPrograms(wanted)
      .then((paths) => {
        if (!live) return;
        setFound(new Map(wanted.map((name, index) => [name, paths[index] ?? null])));
      })
      .catch(() => {
        if (live) setFound(new Map());
      });
    return () => {
      live = false;
    };
  }, [key]);
  return found;
}

/**
 * What a profile's row says of its program: `found` where the lookup finds it at the path that
 * was allowed, `not_found` where it does not, `add_again` for a stored profile whose allowed
 * path is not known, and `unknown` for a full path or before the lookup answers.
 */
export type ProgramState = "found" | "not_found" | "add_again" | "unknown";

export function programState(
  profile: AgentProgramProfile,
  found: Map<string, string | null>,
): ProgramState {
  if (profile.resolvedProgram === null) return "add_again";
  if (!isBareName(profile.program) || !found.has(profile.program)) return "unknown";
  return found.get(profile.program) === profile.resolvedProgram ? "found" : "not_found";
}
