import { expect, it } from "vitest";
import { inspectConfirmation } from "./confirmation.js";
import type { Group } from "./group.js";

const group: Group = {
  name: "api",
  reason: "仕様と実装を確認",
  files: ["a", "b"],
  confirmation: { definition: "definition", hashes: { a: "hash-a", b: "hash-b" } },
};
const members = [
  { path: "a", hash: "hash-a" },
  { path: "b", hash: "hash-b" },
];

it("requires an explicit record even when every member has a current hash", () => {
  const unconfirmed: Group = { name: group.name, reason: group.reason, files: group.files };
  const result = inspectConfirmation(unconfirmed, "definition", members);
  expect(result.status).toBe("unconfirmed");
  expect(result.files.every((file) => file.changed === null)).toBe(true);
});

it("confirms matching content and restores confirmation when the same content returns", () => {
  expect(inspectConfirmation(group, "definition", members).status).toBe("confirmed");
  expect(
    inspectConfirmation(
      group,
      "definition",
      members.map((file) => ({ ...file, hash: "new" })),
    ).status,
  ).toBe("unconfirmed");
  expect(inspectConfirmation(group, "definition", members).status).toBe("confirmed");
});

it.each(["a", "b"])(
  "detects a change originating from %s and retains unchanged targets",
  (path) => {
    const changed = members.map((file) => (file.path === path ? { ...file, hash: "new" } : file));
    const result = inspectConfirmation(group, "definition", changed);
    expect(result.status).toBe("unconfirmed");
    expect(result.files.find((file) => file.path === path)?.changed).toBe(true);
    expect(result.files.find((file) => file.path !== path)?.changed).toBe(false);
  },
);

it("invalidates a confirmation for a different definition even with matching content", () => {
  expect(inspectConfirmation(group, "new-definition", members).status).toBe("unconfirmed");
});

it.each([{ files: [] }, { files: ["a"] }])(
  "never confirms an incomplete group: $files",
  ({ files }) => {
    expect(inspectConfirmation({ ...group, files }, "definition", members).status).toBe(
      "unconfirmed",
    );
  },
);

it("never confirms a missing or unreadable member", () => {
  expect(inspectConfirmation(group, "definition", [members[0]!]).status).toBe("unconfirmed");
  expect(
    inspectConfirmation(group, "definition", [members[0]!, { path: "b", hash: null }]).status,
  ).toBe("unconfirmed");
});
