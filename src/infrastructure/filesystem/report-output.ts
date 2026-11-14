import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CrosslinkError } from "../../domain/errors.js";

export function writeNewReport(file: string, html: string): void {
  const temporary = join(dirname(file), `.crosslink-report-${randomUUID()}.tmp`);
  let created = false;
  try {
    const fd = openSync(temporary, "wx", 0o600);
    created = true;
    try {
      writeFileSync(fd, html, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // 完成した内容だけを公開する。linkは既存ファイルやsymlinkを置換しない。
    linkSync(temporary, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CrosslinkError(
        "REPORT_EXISTS",
        `Output already exists: ${file}. Choose a different output path.`,
      );
    throw new CrosslinkError(
      "REPORT_WRITE_FAILED",
      `Cannot write HTML report: ${file}. Ensure the parent directory exists and is writable. ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (created) unlinkSync(temporary);
  }
}
