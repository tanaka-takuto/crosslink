import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "crosslink-runtime-"));
  roots.push(root);
  // node_modulesやpnpmのない場所へビルド結果だけをコピーして実行する。
  cpSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dist"), join(root, "dist"), {
    recursive: true,
  });
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), Buffer.from([0, 255]));
  const call = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, "dist/cli.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });
  return { root, call };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("runs the full CLI with Node alone and keeps JSON stdout clean", () => {
  const { root, call } = fixture();
  expect(call("create", "api", "a", "b", "--reason", "整合性").status).toBe(0);
  const checked = call("check", "--json");
  expect(checked.status).toBe(1);
  expect(checked.stderr).toBe("");
  const result = JSON.parse(checked.stdout);
  expect(result.groups).toHaveLength(1);
  const review = join(root, "review.json");
  writeFileSync(review, checked.stdout);
  expect(call("confirm", ".crosslink/api.json", "--snapshot", review).status).toBe(0);
  expect(call("check").status).toBe(0);
  const before = readFileSync(join(root, ".crosslink/api.json"), "utf8");
  call("check");
  expect(readFileSync(join(root, ".crosslink/api.json"), "utf8")).toBe(before);
  writeFileSync(join(root, "b"), "changed");
  expect(call("check").status).toBe(1);
  expect(call("confirm", ".crosslink/api.json", "--snapshot", review).status).toBe(2);
});

it("serializes invocation errors as JSON without a stack trace", () => {
  const { call } = fixture();
  const result = call("check", "--unknown", "--json");
  expect(result.status).toBe(2);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).result).toBe("error");
});

it("does not mistake a positional file named --json for an output option", () => {
  const { root, call } = fixture();
  writeFileSync(join(root, "--json"), "file");
  const result = call("create", "name", "--reason", "理由", "--", "--json", "a");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("保存しました");
});

it("refuses two concurrent confirmation processes from the same snapshot", async () => {
  const { root, call } = fixture();
  call("create", "api", "a", "b", "--reason", "理由");
  const review = join(root, "review.json");
  writeFileSync(review, call("check", "--json").stdout);
  const results = await Promise.all(
    [0, 1].map(async () => {
      const { spawn } = await import("node:child_process");
      return new Promise<number | null>((done) => {
        const child = spawn(
          process.execPath,
          [join(root, "dist/cli.js"), "confirm", ".crosslink/api.json", "--snapshot", review],
          { cwd: root, stdio: "ignore" },
        );
        child.on("exit", done);
      });
    }),
  );
  expect(results.sort()).toEqual([0, 2]);
  expect(call("check").status).toBe(0);
});
