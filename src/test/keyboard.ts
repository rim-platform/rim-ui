import { expect } from "vitest";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Press Tab from the top of the page until focus comes back around, and return every element
 * focus landed on, in order. This is the set a keyboard-only user can reach.
 */
export async function tabOrder(user: UserEvent, limit = 300): Promise<HTMLElement[]> {
  (document.activeElement as HTMLElement | null)?.blur();
  const reached: HTMLElement[] = [];
  for (let step = 0; step < limit; step += 1) {
    await user.tab();
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) break;
    if (reached.includes(active)) break;
    reached.push(active);
  }
  return reached;
}

/**
 * Assert that Tab reaches each of `targets`. Name the primary actions of a surface: its main
 * buttons, fields and lists.
 */
export async function expectReachableByKeyboard(
  user: UserEvent,
  targets: readonly HTMLElement[],
): Promise<HTMLElement[]> {
  const reached = await tabOrder(user);
  const describe = (element: HTMLElement) =>
    element.getAttribute("aria-label") ??
    element.getAttribute("placeholder") ??
    (element.textContent?.trim() || element.outerHTML.slice(0, 80));
  const missing = targets.filter((target) => !reached.includes(target)).map(describe);
  expect(missing, `not reachable with Tab: ${missing.join(", ")}`).toEqual([]);
  return reached;
}
