import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["source", "module", "node", "development|production"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/types/**"],
    },
  },
});
