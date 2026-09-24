import { defineConfig, mergeConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared.ts";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: "api",
      include: ["test/**/*.test.ts"],
      env: { DB_PATH: ":memory:" },
    },
  }),
);
