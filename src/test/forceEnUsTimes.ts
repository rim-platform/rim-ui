import { vi } from "vitest";

/** Makes Date's locale-sensitive formatters use en-US, so time assertions do not depend on the machine. */
export function forceEnUsTimes(): void {
  for (const name of ["toLocaleTimeString", "toLocaleDateString", "toLocaleString"] as const) {
    const original = Date.prototype[name];
    vi.spyOn(Date.prototype, name).mockImplementation(function (
      this: Date,
      _locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return original.call(this, "en-US", options);
    });
  }
}
