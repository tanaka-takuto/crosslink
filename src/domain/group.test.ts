import { expect, it } from "vitest";
import { canonicalDefinition, inspectionProblems, validateGroup, type Group } from "./group.js";

const group: Group = { name: "api", reason: "仕様と実装を確認", files: ["a", "b"] };

it.each([
  { change: { name: "" }, code: "INVALID_DEFINITION" },
  { change: { name: " " }, code: "INVALID_DEFINITION" },
  { change: { reason: "" }, code: "INVALID_DEFINITION" },
  { change: { reason: " " }, code: "INVALID_DEFINITION" },
  { change: { files: ["a", "a"] }, code: "DUPLICATE_MEMBER" },
  { change: { files: ["a", "\0"] }, code: "INVALID_DEFINITION" },
])("rejects invalid group $change with $code", ({ change, code }) => {
  expect(() => validateGroup({ ...group, ...change })).toThrow(expect.objectContaining({ code }));
});

it.each([{ files: [] }, { files: ["a"] }])(
  "accepts $files for editing but reports an invalid inspection",
  ({ files }) => {
    const draft = { ...group, files };
    expect(() => validateGroup(draft)).not.toThrow();
    expect(inspectionProblems(draft)).toEqual([expect.objectContaining({ code: "TOO_FEW_FILES" })]);
    const message = inspectionProblems(draft)[0]!.message;
    expect(message).toContain(`found ${files.length}`);
    expect(message).toContain("Add member files");
    expect(message).toContain("read all related files before confirming");
    expect(inspectionProblems(group)).toEqual([]);
  },
);

it("canonicalizes the definition independently of member order and confirmation records", () => {
  const same = {
    ...group,
    files: ["b", "a"],
    confirmation: { definition: "a".repeat(64), hashes: {} },
  };
  expect(canonicalDefinition(same)).toBe(canonicalDefinition(group));
  for (const change of [{ name: "other" }, { reason: "other" }, { files: ["a", "c"] }])
    expect(canonicalDefinition({ ...group, ...change })).not.toBe(canonicalDefinition(group));
});
