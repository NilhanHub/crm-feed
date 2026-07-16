import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] },
    // API integration tests share on-disk JSON collections under data/db/.
    // Running test files in separate forks concurrently causes filesystem races
    // (one file's clear vs another's write). Single-fork serialises all test
    // files so they cannot interfere. The cost (~2s total) is negligible.
    pool: "forks",
    // Vitest 4 removed poolOptions.singleFork. Disabling file-level
    // parallelism preserves the same on-disk store isolation contract.
    fileParallelism: false,
  },
});
