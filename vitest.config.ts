import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "vitest/config";

const testSigningKey = Buffer.from(
  generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  "utf8",
).toString("base64");

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
    env: {
      NODE_ENV: "test",
      DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: "5433",
      DATABASE_NAME: "identity_test",
      DATABASE_USER: "identity_app",
      DATABASE_PASSWORD: "test-password",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6380",
      REDIS_PASSWORD: "test-password",
      JWT_SIGNING_KEY: testSigningKey,
      JWT_ISSUER: "https://identity.test.local",
      JWT_AUDIENCE: "mktdash-test",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/types/**"],
    },
  },
});
