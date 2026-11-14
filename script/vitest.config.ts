import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["script/check-version.test.ts", "script/release.test.ts"] },
});
