import { defineConfig, mergeConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared.ts";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: "api",
      include: ["test/**/*.test.ts"],
      // Real, shared Neon DB now — files must not run concurrently, or
      // they'd race on the same fixture payables/vendors.
      fileParallelism: false,
      testTimeout: 20_000,
    },
  }),
);
