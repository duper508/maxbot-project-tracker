import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      APP_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  },
});
