import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every DB-backed test file calls resetDb(), which TRUNCATEs the shared
    // craigsnotice_test database. Running files in parallel lets one file wipe
    // another's fixtures mid-test, so files run sequentially.
    fileParallelism: false,
  },
});
