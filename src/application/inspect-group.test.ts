import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectGroup as inspect } from "./inspect-group.js";
import { filesystemPorts } from "../infrastructure/filesystem/adapter.js";
import { defaults } from "../infrastructure/filesystem/settings.js";
const inspectGroup = (file: string) => inspect(file, filesystemPorts, defaults);

const roots: string[] = [];

function fixture(files: string[] = ["../a", "../b"]) {
  const root = mkdtempSync(join(tmpdir(), "crosslink-test-"));
  roots.push(root);
  mkdirSync(join(root, ".crosslink"));
  writeFileSync(join(root, "a"), "a");
  writeFileSync(join(root, "b"), Buffer.from([0, 255, 128]));
  const file = join(root, ".crosslink", "test.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 1, name: "test", reason: "一緒に確認するため", files }),
  );
  return { root, file };
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("inspection", () => {
  it("new groups are unconfirmed and expose every file, including binary files", () => {
    const { file } = fixture();
    const result = inspectGroup(file);
    expect(result.status).toBe("unconfirmed");
    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(2);
    expect(result.snapshot).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([{ files: [] }, { files: ["../a"] }])(
    "allows saving a draft with $files, but reports an invalid group",
    ({ files }) => {
      const { file } = fixture(files);
      expect(inspectGroup(file).errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "TOO_FEW_FILES" })]),
      );
    },
  );

  it("diagnoses missing files without marking the group confirmed", () => {
    const { file } = fixture(["../a", "../missing"]);
    expect(inspectGroup(file).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "FILE_UNREADABLE" })]),
    );
  });

  it("rejects a confirmation file as a member", () => {
    const { file } = fixture(["../a", "test.json"]);
    expect(inspectGroup(file).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MANAGEMENT_FILE" })]),
    );
  });

  it("reports malformed definitions", () => {
    const { file } = fixture();
    writeFileSync(file, "{");
    expect(inspectGroup(file).errors.length).toBeGreaterThan(0);
    expect(inspectGroup(file).status).toBe("unconfirmed");
  });
});
