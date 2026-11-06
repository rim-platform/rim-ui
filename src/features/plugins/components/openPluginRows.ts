import { fireEvent } from "@testing-library/react";

/** Opens every closed plugin row on the page, so the controls inside them can be reached. */
export function openPluginRows() {
  document
    .querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"][aria-controls]')
    .forEach((button) => fireEvent.click(button));
}
