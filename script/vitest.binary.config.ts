import { defineConfig } from "vitest/config";

// Node26のSEA生成を必要とする検査を、Node24でも動かす通常テストから分ける。
export default defineConfig({
  test: { include: ["script/build-binary.test.ts"] },
});
