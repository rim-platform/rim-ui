import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          css: false,
        },
      },
      {
        // The plugin SDK and plugins are Node programs: no DOM, no app test setup.
        test: {
          name: "plugin-sdk",
          environment: "node",
          include: ["sdk/**/*.test.ts", "plugins/**/*.test.ts"],
        },
      },
    ],
  },
});
