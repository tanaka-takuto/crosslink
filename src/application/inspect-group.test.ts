import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const before = readFileSync(file, "utf8");
    const result = inspectGroup(file);
    expect(result.errors).toEqual([
      {
        code: "FILE_UNREADABLE",
        message: expect.stringContaining("../missing"),
      },
    ]);
    expect(result.errors[0]!.message).toContain("read permissions");
    expect(result.errors[0]!.message).toContain("restore the file");
    expect(result.errors[0]!.message).toContain("update its registered path if moved");
    expect(result.errors[0]!.message).toContain(
      "remove it from the group if deletion was intended",
    );
    expect(result.status).toBe("unconfirmed");
    expect(result.snapshot).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("guides permission failures without guessing that the file was deleted", () => {
    const { root, file } = fixture();
    const before = readFileSync(file, "utf8");
    const ports = {
      ...filesystemPorts,
      files: {
        ...filesystemPorts.files,
        hash: () => {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        },
      },
    };
    const result = inspect(file, ports, defaults);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toEqual({
      code: "FILE_UNREADABLE",
      message: expect.stringContaining("read permissions"),
    });
    expect(result.errors[0]!.message).toContain("../a");
    expect(result.errors[0]!.message).toContain("if deletion was intended");
    expect(result.snapshot).toBeNull();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readFileSync(join(root, "a"), "utf8")).toBe("a");
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
