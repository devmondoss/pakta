import { defineConfig, mergeConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared.ts";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: "db",
      include: ["test/**/*.test.ts"],
      // Real, shared Neon DB now (no more per-process :memory:) — files
      // must not run concurrently, or they'd race on the same tables.
      fileParallelism: false,
      testTimeout: 20_000,
    },
  }),
);
