import { expect, it } from "vitest";
import { parseGroup, type GroupRecord } from "./group-format.js";

const group: GroupRecord = {
  version: 1,
  name: "api",
  reason: "仕様と実装を確認",
  files: ["a", "b"],
};

it("reads both legacy and declared group definitions, including a UTF-8 BOM", () => {
  expect(parseGroup(JSON.stringify(group))).toEqual(group);
  const declared = { kind: "crosslink-group", ...group };
  expect(parseGroup("\uFEFF" + JSON.stringify(declared))).toEqual(declared);
});

it.each([
  { change: { version: 2 }, code: "UNSUPPORTED_VERSION" },
  { change: { kind: "other" }, code: "INVALID_DEFINITION" },
  { change: { confirmation: { definition: "bad", hashes: {} } }, code: "INVALID_CONFIRMATION" },
  { change: { extra: true }, code: "INVALID_DEFINITION" },
])("rejects invalid stored definition $change with $code", ({ change, code }) => {
  expect(() => parseGroup(JSON.stringify({ ...group, ...change }))).toThrow(
    expect.objectContaining({ code }),
  );
});

it.each(["{", "null", "[]"])("rejects malformed or non-object definitions: %s", (text) => {
  expect(() => parseGroup(text)).toThrow();
});
