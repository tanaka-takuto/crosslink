import { expect, it } from "vitest";
import { inspectConfirmation } from "./confirmation.js";
import { canonicalDefinition, validateGroup, type Group } from "./group.js";
import { parseGroup } from "../infrastructure/filesystem/group-format.js";

const hash = "a".repeat(64);
const group = {
  name: "ADR → code",
  reason: "実装への影響",
  files: ["adr", "code"],
  roles: { files: { adr: "source-only", code: "target-only" }, globs: {} },
  confirmation: {
    definition: hash,
    hashes: { adr: "adr", code: "code" },
    roles: { adr: "source-only", code: "target-only" },
  },
} as Group;
const members = [
  { path: "adr", hash: "adr", role: "source-only" as const },
  { path: "code", hash: "code", role: "target-only" as const },
];
it("compares source content while retaining target content differences", () => {
  const result = inspectConfirmation(group, hash, [members[0]!, { ...members[1]!, hash: "new" }]);
  expect(result.status).toBe("confirmed");
  expect(result.files[1]!.changed).toBe(true);
  expect(
    inspectConfirmation(group, hash, [{ ...members[0]!, hash: "new" }, members[1]!]).status,
  ).toBe("unconfirmed");
  expect(inspectConfirmation(group, hash, members).status).toBe("confirmed");
});
it("compares source paths and ignores valid target-only membership changes", () => {
  const dynamic = { ...group, files: [], globs: ["*"] };
  expect(
    inspectConfirmation(dynamic, hash, [
      members[0]!,
      { path: "new-code", hash: "new", role: "target-only" },
    ]).status,
  ).toBe("confirmed");
  expect(
    inspectConfirmation(dynamic, hash, [{ ...members[0]!, path: "renamed-adr" }, members[1]!])
      .status,
  ).toBe("unconfirmed");
  expect(
    inspectConfirmation(dynamic, hash, [members[1]!, { ...members[1]!, path: "new-code" }]).status,
  ).toBe("unconfirmed");
});
it("uses v3 only for explicit roles and includes roles in the canonical definition", () => {
  const legacy = { name: group.name, reason: group.reason, files: group.files };
  expect(canonicalDefinition(legacy)).toBe(JSON.stringify(legacy));
  expect(canonicalDefinition(group)).not.toBe(canonicalDefinition(legacy));
  expect(
    parseGroup(JSON.stringify({ version: 3, ...group, confirmation: undefined })).roles,
  ).toEqual(group.roles);
});
it.each([
  { files: { adr: "invalid" }, globs: {} },
  { files: { missing: "source-only" }, globs: {} },
  { files: {}, globs: { "*": "target-only" } },
  { files: { adr: "both" }, globs: {} },
  { files: {}, globs: {}, unknown: true },
])("rejects malformed or unbound selector roles %j", (roles) => {
  expect(() => validateGroup({ ...group, roles } as Group)).toThrow();
});
it("rejects v3 broken role baselines and v1/v2 role extensions", () => {
  for (const version of [1, 2])
    expect(() => parseGroup(JSON.stringify({ ...group, version }))).toThrow();
  for (const roles of [
    undefined,
    {},
    { adr: "source-only" },
    { adr: "invalid", code: "target-only" },
  ]) {
    expect(() =>
      parseGroup(
        JSON.stringify({
          ...group,
          version: 3,
          confirmation: { definition: hash, hashes: { adr: hash, code: hash }, roles },
        }),
      ),
    ).toThrow();
  }
});

it.each([
  { hashes: {}, roles: {} },
  { hashes: { a: hash }, roles: { a: "both" } },
  { hashes: { a: hash, b: hash }, roles: { a: "source-only", b: "source-only" } },
  { hashes: { a: hash, b: hash }, roles: { a: "target-only", b: "target-only" } },
  { hashes: { "": hash, b: hash }, roles: { "": "source-only", b: "target-only" } },
])("rejects an impossible directional confirmation baseline %j", (record) => {
  expect(() =>
    parseGroup(
      JSON.stringify({ ...group, version: 3, confirmation: { definition: hash, ...record } }),
    ),
  ).toThrow(expect.objectContaining({ code: "INVALID_CONFIRMATION" }));
});
