import { CrosslinkError, type Problem } from "./errors.js";

export interface Group {
  name: string;
  reason: string;
  files: string[];
  confirmation?: { definition: string; hashes: Record<string, string> };
}

export function validateGroup(group: Group): void {
  if (
    typeof group.name !== "string" ||
    !group.name.trim() ||
    typeof group.reason !== "string" ||
    !group.reason.trim()
  )
    throw new CrosslinkError("INVALID_DEFINITION", "名前と確認が必要な理由は必須です");
  if (
    !Array.isArray(group.files) ||
    group.files.some((file) => typeof file !== "string" || !file.trim() || file.includes("\0"))
  )
    throw new CrosslinkError("INVALID_DEFINITION", "filesにはファイルパスの配列を指定してください");
  if (new Set(group.files).size !== group.files.length)
    throw new CrosslinkError("DUPLICATE_MEMBER", "同じパスが複数登録されています");
}

export function inspectionProblems(group: Group): Problem[] {
  return group.files.length < 2
    ? [{ code: "TOO_FEW_FILES", message: "検査には2ファイル以上が必要です" }]
    : [];
}

export function canonicalDefinition(group: Group): string {
  return JSON.stringify({ name: group.name, reason: group.reason, files: [...group.files].sort() });
}
