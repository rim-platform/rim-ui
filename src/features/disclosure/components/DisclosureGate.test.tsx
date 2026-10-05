import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { SkillTier, useDisclosureStore } from "../state/useDisclosureStore";
import { DisclosureGate } from "./DisclosureGate";

function setTier(tier: SkillTier) {
  useDisclosureStore.setState({ skillTier: tier, featuresUsed: new Set(), isLoaded: true });
}

beforeEach(() => {
  requestMock.mockReset();
  useDisclosureStore.setState({
    skillTier: SkillTier.BEGINNER,
    featuresUsed: new Set(),
    isLoaded: false,
  });
});

describe("DisclosureGate", () => {
  it("renders nothing, not even the fallback, until the profile has loaded", async () => {
    let resolve: (value: unknown) => void = () => {};
    requestMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(
      <DisclosureGate minTier={SkillTier.BEGINNER} fallback={<span>basic</span>}>
        <span>advanced</span>
      </DisclosureGate>,
    );
    expect(screen.queryByText("advanced")).not.toBeInTheDocument();
    expect(screen.queryByText("basic")).not.toBeInTheDocument();

    resolve({ mySkillProfile: { skillTier: SkillTier.BEGINNER, featuresUsed: [] } });
    expect(await screen.findByText("advanced")).toBeInTheDocument();
  });

  it("loads the skill profile and then opens for a qualifying tier", async () => {
    requestMock.mockResolvedValue({
      mySkillProfile: { skillTier: SkillTier.ADVANCED, featuresUsed: [] },
    });
    render(
      <DisclosureGate minTier={SkillTier.INTERMEDIATE}>
        <span>escalation</span>
      </DisclosureGate>,
    );

    expect(await screen.findByText("escalation")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("stays closed for a BEGINNER profile and shows the fallback", async () => {
    requestMock.mockResolvedValue({
      mySkillProfile: { skillTier: SkillTier.BEGINNER, featuresUsed: [] },
    });
    render(
      <DisclosureGate minTier={SkillTier.INTERMEDIATE} fallback={<span>basic</span>}>
        <span>escalation</span>
      </DisclosureGate>,
    );

    expect(await screen.findByText("basic")).toBeInTheDocument();
    expect(screen.queryByText("escalation")).not.toBeInTheDocument();
  });

  it.each([
    [SkillTier.BEGINNER, SkillTier.BEGINNER, true],
    [SkillTier.BEGINNER, SkillTier.INTERMEDIATE, false],
    [SkillTier.BEGINNER, SkillTier.ADVANCED, false],
    [SkillTier.INTERMEDIATE, SkillTier.INTERMEDIATE, true],
    [SkillTier.INTERMEDIATE, SkillTier.ADVANCED, false],
    [SkillTier.ADVANCED, SkillTier.INTERMEDIATE, true],
    [SkillTier.ADVANCED, SkillTier.ADVANCED, true],
  ])("a %s user %s-gated content: shown=%s", (tier, minTier, shown) => {
    setTier(tier);
    render(
      <DisclosureGate minTier={minTier} fallback={<span>fallback</span>}>
        <span>gated</span>
      </DisclosureGate>,
    );
    expect(screen.queryByText("gated") !== null).toBe(shown);
    expect(screen.queryByText("fallback") !== null).toBe(!shown);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("re-renders when the tier is promoted", () => {
    setTier(SkillTier.BEGINNER);
    const { rerender } = render(
      <DisclosureGate minTier={SkillTier.ADVANCED}>
        <span>macros</span>
      </DisclosureGate>,
    );
    expect(screen.queryByText("macros")).not.toBeInTheDocument();

    setTier(SkillTier.ADVANCED);
    rerender(
      <DisclosureGate minTier={SkillTier.ADVANCED}>
        <span>macros</span>
      </DisclosureGate>,
    );
    expect(screen.getByText("macros")).toBeInTheDocument();
  });
});
