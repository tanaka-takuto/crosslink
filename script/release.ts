import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateVersion } from "./check-version.ts";

export type Release = {
  id: number;
  tag_name: string;
  target_commitish: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
};
export type Asset = { id: number; name: string; size: number; state: string };
export interface ReleaseApi {
  tagSha(tag: string): Promise<string | null>;
  createTag(tag: string, sha: string): Promise<void>;
  findRelease(tag: string): Promise<Release | null>;
  generateNotes(tag: string, sha: string): Promise<{ name: string; body: string }>;
  createRelease(release: Omit<Release, "id">): Promise<Release>;
  assets(id: number): Promise<Asset[]>;
  upload(id: number, name: string, bytes: Uint8Array): Promise<void>;
  download(asset: Asset): Promise<Uint8Array>;
  publish(id: number): Promise<Release>;
}
type Input = { sha: string; version: string };
type ManifestInput = Input & { platform: string; arch: string };
type Manifest = ManifestInput & { files: Record<string, string> };
const targets = [
  { platform: "linux", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "win32", arch: "x64" },
];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function validateInput(input: Input) {
  if (!/^[a-f0-9]{40}$/.test(input.sha)) throw new Error("Release SHA must be a full commit SHA");
  validateVersion({ version: input.version, private: true });
}
function targetFiles({ platform, arch }: { platform: string; arch: string }) {
  if (!targets.some((target) => target.platform === platform && target.arch === arch)) {
    throw new Error(`Unsupported release target: ${platform}-${arch}`);
  }
  const target = `crosslink-${platform}-${arch}`;
  const binary = `${target}${platform === "win32" ? ".exe" : ""}`;
  return { target, binary, checksum: `${binary}.sha256` };
}

export function writeManifest(directory: string, input: ManifestInput): string {
  validateInput(input);
  const { target, binary, checksum } = targetFiles(input);
  const bytes = readFileSync(join(directory, binary));
  const sum = readFileSync(join(directory, checksum));
  // builderのhash単体形式とsha256sum形式の両方を読み、別ファイル名への置換を拒否する。
  const text = sum.toString("utf8").replace(/\r?\n$/, "");
  const expected = digest(bytes);
  if (![expected, `${expected}  ${binary}`, `${expected} *${binary}`].includes(text)) {
    throw new Error(`Invalid checksum: ${checksum}`);
  }
  const manifest: Manifest = { ...input, files: { [binary]: expected, [checksum]: digest(sum) } };
  writeFileSync(join(directory, `${target}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

function loadArtifacts(directory: string, input: Input): Map<string, Buffer> {
  validateInput(input);
  const result = new Map<string, Buffer>();
  const expectedNames: string[] = [];
  for (const target of targets) {
    const { target: name, binary, checksum } = targetFiles(target);
    const manifestName = `${name}.json`;
    const manifest = JSON.parse(readFileSync(join(directory, manifestName), "utf8")) as Manifest;
    if (
      manifest.sha !== input.sha ||
      manifest.version !== input.version ||
      manifest.platform !== target.platform ||
      manifest.arch !== target.arch
    ) {
      throw new Error(`Release manifest does not match SHA/version/target: ${manifestName}`);
    }
    for (const file of [binary, checksum]) {
      const bytes = readFileSync(join(directory, file));
      if (manifest.files?.[file] !== digest(bytes))
        throw new Error(`Release manifest hash mismatch: ${file}`);
      result.set(file, bytes);
    }
    const expected = digest(result.get(binary)!);
    const text = result
      .get(checksum)!
      .toString("utf8")
      .replace(/\r?\n$/, "");
    if (![expected, `${expected}  ${binary}`, `${expected} *${binary}`].includes(text))
      throw new Error(`Invalid checksum: ${checksum}`);
    expectedNames.push(binary, checksum, manifestName);
  }
  if (readdirSync(directory).sort().join("\n") !== expectedNames.sort().join("\n"))
    throw new Error("Unexpected release artifact files");
  return result;
}

async function verifyAssets(
  api: ReleaseApi,
  id: number,
  local: Map<string, Buffer>,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const asset of await api.assets(id)) {
    const bytes = local.get(asset.name);
    if (!bytes || found.has(asset.name)) throw new Error(`Unexpected asset: ${asset.name}`);
    if (
      asset.state !== "uploaded" ||
      asset.size !== bytes.length ||
      digest(await api.download(asset)) !== digest(bytes)
    ) {
      throw new Error(`Release asset verification failed: ${asset.name}`);
    }
    found.add(asset.name);
  }
  return found;
}

export async function publishRelease(
  input: Input & { directory: string },
  api: ReleaseApi,
): Promise<void> {
  // 全OSのmanifestとチェックサムを確認するまでGitHubへ書き込まない。
  const local = loadArtifacts(input.directory, input);
  const tag = `v${input.version}`;
  const marker = `<!-- crosslink-release:${input.sha} -->`;
  const tagSha = await api.tagSha(tag);
  if (tagSha !== null && tagSha !== input.sha) throw new Error(`Release tag SHA mismatch: ${tag}`);
  let release = await api.findRelease(tag);
  if (
    release &&
    (tagSha !== input.sha ||
      release.tag_name !== tag ||
      release.target_commitish !== input.sha ||
      !release.body?.includes(marker))
  ) {
    throw new Error("Existing release provenance does not match the verified SHA");
  }
  if (!release) {
    const notes = await api.generateNotes(tag, input.sha);
    if (!notes.body?.trim()) throw new Error("Generated release notes are empty");
    if (tagSha === null) await api.createTag(tag, input.sha);
    release = await api.createRelease({
      tag_name: tag,
      target_commitish: input.sha,
      body: `${notes.body}\n\n${marker}`,
      draft: true,
      prerelease: input.version.split("+")[0]!.includes("-"),
    });
    if (
      !release.draft ||
      release.tag_name !== tag ||
      release.target_commitish !== input.sha ||
      !release.body?.includes(marker)
    ) {
      throw new Error("Created release is not the expected draft");
    }
  }
  const existing = await verifyAssets(api, release.id, local);
  if (!release.draft) {
    if (existing.size !== local.size)
      throw new Error("Published release is incomplete; manual investigation is required");
    if ((await api.tagSha(tag)) !== input.sha)
      throw new Error(`Release tag SHA mismatch after asset verification: ${tag}`);
    console.log(`Published release verified without changes: ${tag}`);
    return;
  }
  // 同SHAのdraftは不足分だけ再開する。既存assetの削除・上書きは行わない。
  for (const [name, bytes] of local) {
    if (!existing.has(name)) await api.upload(release.id, name, bytes);
  }
  if ((await verifyAssets(api, release.id, local)).size !== local.size)
    throw new Error("Release assets are incomplete");
  if ((await api.tagSha(tag)) !== input.sha)
    throw new Error(`Release tag SHA mismatch before publish: ${tag}`);
  const published = await api.publish(release.id);
  if (published.draft || published.tag_name !== tag)
    throw new Error("Release publication could not be verified");
  console.log(`Release published: ${tag} (${input.sha})`);
}

// REST通信は公開jobだけで使用する。404以外の取得失敗を「存在しない」と解釈しない。
export class GitHubReleaseApi implements ReleaseApi {
  private repository: string;
  private token: string;
  constructor(repository: string, token: string) {
    this.repository = repository;
    this.token = token;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token)
      throw new Error("Repository and GitHub token are required");
  }
  private async request(
    method: string,
    path: string,
    body?: unknown,
    allow404 = false,
  ): Promise<Response> {
    const response = await fetch(`https://api.github.com/repos/${this.repository}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok && !(allow404 && response.status === 404))
      throw new Error(`GitHub ${method} ${path} failed: HTTP ${response.status}`);
    return response;
  }
  async tagSha(tag: string): Promise<string | null> {
    const response = await this.request(
      "GET",
      `git/ref/tags/${encodeURIComponent(tag)}`,
      undefined,
      true,
    );
    if (response.status === 404) return null;
    let ref = (await response.json()) as { object: { type: string; sha: string } };
    for (let depth = 0; depth < 10; depth++) {
      if (ref.object.type === "commit") return ref.object.sha;
      if (ref.object.type !== "tag") break;
      ref = (await (await this.request("GET", `git/tags/${ref.object.sha}`)).json()) as typeof ref;
    }
    throw new Error(`Release tag does not resolve to a commit: ${tag}`);
  }
  async createTag(tag: string, sha: string): Promise<void> {
    await this.request("POST", "git/refs", { ref: `refs/tags/${tag}`, sha });
  }
  async findRelease(tag: string): Promise<Release | null> {
    // 一覧APIは書込tokenでdraftも取得できる。ページ末尾まで調べる。
    for (let page = 1; ; page++) {
      const releases = (await (
        await this.request("GET", `releases?per_page=100&page=${page}`)
      ).json()) as Release[];
      const release = releases.find((item) => item.tag_name === tag);
      if (release) return release;
      if (releases.length < 100) return null;
    }
  }
  async generateNotes(tag: string, sha: string): Promise<{ name: string; body: string }> {
    return (await (
      await this.request("POST", "releases/generate-notes", {
        tag_name: tag,
        target_commitish: sha,
      })
    ).json()) as { name: string; body: string };
  }
  async createRelease(release: Omit<Release, "id">): Promise<Release> {
    return (await (
      await this.request("POST", "releases", {
        ...release,
        name: release.tag_name,
        make_latest: "false",
      })
    ).json()) as Release;
  }
  async assets(id: number): Promise<Asset[]> {
    const assets: Asset[] = [];
    for (let page = 1; ; page++) {
      const items = (await (
        await this.request("GET", `releases/${id}/assets?per_page=100&page=${page}`)
      ).json()) as Asset[];
      assets.push(...items);
      if (items.length < 100) return assets;
    }
  }
  async upload(id: number, name: string, bytes: Uint8Array): Promise<void> {
    const response = await fetch(
      `https://uploads.github.com/repos/${this.repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: new Blob([Uint8Array.from(bytes)]),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok)
      throw new Error(`Release asset upload failed: ${name} (HTTP ${response.status})`);
  }
  async download(asset: Asset): Promise<Uint8Array> {
    const response = await fetch(
      `https://api.github.com/repos/${this.repository}/releases/assets/${asset.id}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok)
      throw new Error(`Release asset download failed: ${asset.name} (HTTP ${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async publish(id: number): Promise<Release> {
    return (await (
      await this.request("PATCH", `releases/${id}`, { draft: false, make_latest: "legacy" })
    ).json()) as Release;
  }
}

if (import.meta.main) {
  try {
    const [command, directory, ...extra] = process.argv.slice(2);
    if (!directory || extra.length || !["manifest", "publish"].includes(command ?? ""))
      throw new Error("Usage: release.ts <manifest|publish> <artifact-directory>");
    const { version } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const sha = process.env.GITHUB_SHA ?? "";
    if (command === "manifest") {
      const target = writeManifest(directory, {
        sha,
        version,
        platform: process.platform,
        arch: process.arch,
      });
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `target=${target}\n`);
    } else {
      if (process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF !== "refs/heads/main")
        throw new Error("Release publication is allowed only for a main push");
      await publishRelease(
        { directory, sha, version },
        new GitHubReleaseApi(process.env.GITHUB_REPOSITORY ?? "", process.env.GH_TOKEN ?? ""),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
