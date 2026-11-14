import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { applicationMetadata } from "./version-reader.js";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it("returns the packaged application version", () => {
  vi.mocked(readFileSync).mockReturnValue('{"version":"0.2.0"}');
  expect(applicationMetadata.version()).toBe("0.2.0");
});

it.each(["null", "{}", '{"version":1}', '{"version":" "}'])(
  "rejects invalid application metadata %s with an English diagnostic",
  (content) => {
    vi.mocked(readFileSync).mockReturnValue(content);
    expect(() => applicationMetadata.version()).toThrow(
      "Application package.json must contain a version.",
    );
  },
);
