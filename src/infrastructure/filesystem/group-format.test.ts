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

it.each([
  { text: "{", code: "INVALID_JSON" },
  { text: "null", code: "INVALID_DEFINITION" },
  { text: JSON.stringify({ ...group, extra: true }), code: "INVALID_DEFINITION" },
  { text: JSON.stringify({ ...group, kind: "other" }), code: "INVALID_DEFINITION" },
  { text: JSON.stringify({ ...group, name: "" }), code: "INVALID_DEFINITION" },
  { text: JSON.stringify({ ...group, files: null }), code: "INVALID_DEFINITION" },
  { text: JSON.stringify({ ...group, files: ["a", "a"] }), code: "DUPLICATE_MEMBER" },
  { text: JSON.stringify({ ...group, confirmation: null }), code: "INVALID_CONFIRMATION" },
  {
    text: JSON.stringify({ ...group, confirmation: { definition: "bad", hashes: {} } }),
    code: "INVALID_CONFIRMATION",
  },
])("suggests repairing or restoring management JSON for $code: $text", ({ text, code }) => {
  expect(() => parseGroup(text)).toThrow(
    expect.objectContaining({
      code,
      message: expect.stringContaining("Repair the management JSON or restore a valid copy"),
    }),
  );
});

it("guides unsupported management versions without interpreting or changing their contents", () => {
  expect(() => parseGroup(JSON.stringify({ ...group, version: 2 }))).toThrow(
    expect.objectContaining({
      code: "UNSUPPORTED_VERSION",
      message: expect.stringContaining(
        "Use a compatible crosslink version or restore a supported copy",
      ),
    }),
  );
});
