import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  GitHubReleaseApi,
  publishRelease,
  writeManifest,
  type Release,
  type ReleaseApi,
  type Asset,
} from "./release.ts";

const sha = "a".repeat(40);
const version = "0.3.1";
const directories: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
afterEach(() => {
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "crosslink-release-"));
  directories.push(directory);
  for (const [platform, arch] of [
    ["linux", "x64"],
    ["darwin", "arm64"],
    ["win32", "x64"],
  ]) {
    const name = `crosslink-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
    const bytes = Buffer.from(`binary-${platform}-${arch}`);
    writeFileSync(join(directory, name), bytes);
    writeFileSync(join(directory, `${name}.sha256`), `${hash(bytes)}  ${name}\n`);
    writeManifest(directory, { sha, version, platform: platform!, arch: arch! });
  }
  return { directory, sha, version };
}

class FakeApi implements ReleaseApi {
  tag: string | null = null;
  release: Release | null = null;
  bytes = new Map<number, { name: string; bytes: Buffer }>();
  events: string[] = [];
  async tagSha() {
    return this.tag;
  }
  async createTag(_tag: string, target: string) {
    this.events.push("tag");
    this.tag = target;
  }
  async findRelease() {
    return this.release;
  }
  async generateNotes() {
    this.events.push("notes");
    return { name: "Generated title", body: "Generated changes" };
  }
  async createRelease(release: Omit<Release, "id">) {
    this.events.push("draft");
    this.release = { ...release, id: 1 };
    return this.release;
  }
  async assets() {
    return [...this.bytes].map(([id, { name, bytes }]) => ({
      id,
      name,
      size: bytes.length,
      state: "uploaded",
    }));
  }
  async upload(_id: number, name: string, bytes: Uint8Array) {
    expect(this.release?.draft).toBe(true);
    this.events.push(`upload:${name}`);
    this.bytes.set(this.bytes.size + 1, { name, bytes: Buffer.from(bytes) });
  }
  async download(asset: Asset) {
    return this.bytes.get(asset.id)!.bytes;
  }
  async publish() {
    expect(this.bytes.size).toBe(6);
    this.events.push("publish");
    this.release = { ...this.release!, draft: false };
    return this.release;
  }
}

it("publishes only after six assets are uploaded and verified, using generated notes and the exact SHA", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  expect(api.tag).toBe(sha);
  expect(api.release).toMatchObject({
    draft: false,
    tag_name: "v0.3.1",
    target_commitish: sha,
    prerelease: false,
  });
  expect(api.release?.body).toContain("Generated changes");
  expect(api.events.at(-1)).toBe("publish");
  expect(api.events).toContain("notes");
});

it("rejects a tag pointing to another SHA without remote writes", async () => {
  const api = new FakeApi();
  api.tag = "b".repeat(40);
  await expect(publishRelease(fixture(), api)).rejects.toThrow(/tag.*SHA/i);
  expect(api.events).toEqual([]);
});

it("rejects a mismatched manifest before creating a tag or release", async () => {
  const input = fixture();
  const path = join(input.directory, "crosslink-linux-x64.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...manifest, sha: "b".repeat(40) }));
  const api = new FakeApi();
  await expect(publishRelease(input, api)).rejects.toThrow(/manifest/i);
  expect(api.events).toEqual([]);
});

it("rejects a bad checksum or incomplete platform set before any remote write", async () => {
  const input = fixture();
  writeFileSync(
    join(input.directory, "crosslink-linux-x64.sha256"),
    `${"0".repeat(64)}  crosslink-linux-x64\n`,
  );
  const api = new FakeApi();
  await expect(publishRelease(input, api)).rejects.toThrow(/checksum|manifest/i);
  expect(api.events).toEqual([]);
  rmSync(join(input.directory, "crosslink-win32-x64.exe"));
  await expect(publishRelease(input, api)).rejects.toThrow();
  expect(api.events).toEqual([]);
});

it("verifies a published same-SHA rerun without uploads or republishing", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.events = [];
  await publishRelease(input, api);
  expect(api.events).toEqual([]);
});

it("resumes a partial same-SHA draft without replacing existing assets", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.release!.draft = true;
  api.bytes.delete(6);
  api.events = [];
  await publishRelease(input, api);
  expect(api.events).toHaveLength(2);
  expect(api.events[0]).toMatch(/^upload:/);
  expect(api.events[1]).toBe("publish");
});

it("refuses changed bytes on a same-SHA rerun without overwriting", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.bytes.get(1)!.bytes = Buffer.from("different bytes");
  api.events = [];
  await expect(publishRelease(input, api)).rejects.toThrow(/asset/i);
  expect(api.events).toEqual([]);
});

it("does not repair an incomplete published release automatically", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.bytes.delete(6);
  api.events = [];
  await expect(publishRelease(input, api)).rejects.toThrow(/published/i);
  expect(api.events).toEqual([]);
});

it("rejects an existing release with unknown provenance or unexpected assets", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.events = [];
  api.release!.body = "Unverified release";
  await expect(publishRelease(input, api)).rejects.toThrow(/provenance/i);
  api.release!.body = `<!-- crosslink-release:${sha} -->`;
  api.bytes.set(7, { name: "unknown", bytes: Buffer.from("unknown") });
  await expect(publishRelease(input, api)).rejects.toThrow(/unexpected asset/i);
  expect(api.events).toEqual([]);
});

it("leaves a failed upload in draft instead of publishing a partial release", async () => {
  const api = new FakeApi();
  api.upload = async () => {
    throw new Error("Upload failed");
  };
  await expect(publishRelease(fixture(), api)).rejects.toThrow(/Upload failed/);
  expect(api.release?.draft).toBe(true);
  expect(api.events).not.toContain("publish");
});

it("refuses to publish when final downloaded asset bytes are corrupt", async () => {
  const api = new FakeApi();
  api.download = async () => Buffer.from("corrupt");
  await expect(publishRelease(fixture(), api)).rejects.toThrow(/asset/i);
  expect(api.release?.draft).toBe(true);
  expect(api.events).not.toContain("publish");
});

it("detects a moved tag again before publishing", async () => {
  const api = new FakeApi();
  api.tagSha = async () => (api.bytes.size === 6 ? "b".repeat(40) : api.tag);
  await expect(publishRelease(fixture(), api)).rejects.toThrow(/tag.*SHA/i);
  expect(api.release?.draft).toBe(true);
});

it("marks prerelease identifiers, but not a hyphen in build metadata, as prerelease", async () => {
  for (const [value, expected] of [
    ["0.3.1-rc.1+build", true],
    ["0.3.1+build-one", false],
  ] as const) {
    const input = fixture();
    for (const target of ["linux-x64", "darwin-arm64", "win32-x64"]) {
      const path = join(input.directory, `crosslink-${target}.json`);
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(path, JSON.stringify({ ...manifest, version: value }));
    }
    const api = new FakeApi();
    await publishRelease({ ...input, version: value }, api);
    expect(api.release?.prerelease).toBe(expected);
  }
});

it("runs the manifest CLI with Node native TypeScript and blocks publication outside main push", () => {
  const input = fixture();
  const script = new URL("./release.ts", import.meta.url);
  const manifest = spawnSync(
    process.execPath,
    [fileURLToPath(script), "manifest", input.directory],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_SHA: sha, GITHUB_OUTPUT: "" },
    },
  );
  expect(manifest.status, manifest.stderr).toBe(0);
  const publish = spawnSync(process.execPath, [fileURLToPath(script), "publish", input.directory], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main" },
  });
  expect(publish.status).toBe(1);
  expect(publish.stderr).toMatch(/only for a main push/);
});

it("resolves annotated tags to a commit and treats only HTTP 404 as absent", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ object: { type: "tag", sha: "b".repeat(40) } }))
    .mockResolvedValueOnce(Response.json({ object: { type: "commit", sha } }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  const api = new GitHubReleaseApi("owner/repo", "test-token");
  expect(await api.tagSha("v0.3.1")).toBe(sha);
  expect(await api.tagSha("missing")).toBe(null);
  await expect(api.tagSha("forbidden")).rejects.toThrow(/HTTP 403/);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("finds drafts beyond the first release page and stops on API failure", async () => {
  const firstPage = Array.from({ length: 100 }, (_, id) => ({ id, tag_name: `v0.0.${id}` }));
  const draft = { id: 101, tag_name: "v0.3.1", draft: true };
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(firstPage))
    .mockResolvedValueOnce(Response.json([draft]))
    .mockResolvedValueOnce(new Response(null, { status: 500 }));
  const api = new GitHubReleaseApi("owner/repo", "test-token");
  expect(await api.findRelease("v0.3.1")).toEqual(draft);
  await expect(api.findRelease("v0.3.1")).rejects.toThrow(/HTTP 500/);
});

it("rejects a starter asset after an interrupted upload without replacing it", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.release!.draft = true;
  const list = api.assets.bind(api);
  api.assets = async () => (await list()).map((asset) => ({ ...asset, state: "starter" }));
  api.events = [];
  await expect(publishRelease(input, api)).rejects.toThrow(/asset/i);
  expect(api.events).toEqual([]);
});

it("rechecks the tag after verifying an already-published same-SHA release", async () => {
  const input = fixture();
  const api = new FakeApi();
  await publishRelease(input, api);
  api.events = [];
  const download = api.download.bind(api);
  api.download = async (asset) => {
    api.tag = "b".repeat(40);
    return download(asset);
  };
  await expect(publishRelease(input, api)).rejects.toThrow(/tag.*SHA/i);
  expect(api.events).toEqual([]);
});
