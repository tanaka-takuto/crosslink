import { readFileSync } from "node:fs";
import type { ApplicationMetadata } from "../application/ports.js";
import { CrosslinkError } from "../domain/errors.js";

export const applicationMetadata: ApplicationMetadata = {
  version() {
    // 実行先CWDには依存せず、配布物（SEAではVFS）のルートを参照する。
    const value: unknown = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      typeof value.version !== "string" ||
      !value.version.trim()
    )
      throw new CrosslinkError(
        "INVALID_METADATA",
        "Application package.json must contain a version.",
      );
    return value.version;
  },
};
