import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));

export function binaryName(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `crosslink-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

function run(executable: string, args: string[], cwd: string): void {
  const result = spawnSync(executable, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${executable} failed (${result.signal ?? result.status}).`);
}

function assetsIn(directory: string, prefix: string): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const path = join(directory, entry.name);
    // VFSのキーはWindowsでも / 区切りにし、distの階層を保持する。
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(assets, assetsIn(path, key));
    else if (entry.isFile()) assets[key] = path;
    else throw new Error(`Only regular files and directories can be bundled: ${path}`);
  }
  return assets;
}

export function buildBinary(root: string = project) {
  const expectedNode = readFileSync(join(root, ".node-version"), "utf8").trim();
  if (process.versions.node !== expectedNode)
    throw new Error(
      `Binary builds require Node.js ${expectedNode}; found ${process.versions.node}.`,
    );

  const directory = join(root, "tmp/bin");
  const name = binaryName();
  const binary = join(directory, name);
  const checksum = `${binary}.sha256`;
  mkdirSync(directory, { recursive: true });
  // 失敗した再ビルドの後に、前回の成果物を今回の成功と取り違えないようにする。
  rmSync(binary, { force: true });
  rmSync(checksum, { force: true });
  const staging = mkdtempSync(join(directory, ".sea-"));
  try {
    const main = join(staging, "main.mjs");
    const output = join(staging, name);
    const config = join(staging, "sea.json");
    // 通常実行と同じdist/配置により、CLIから ../package.json を参照できる。
    writeFileSync(main, 'import "./dist/cli.js";\n');
    const assets: Record<string, string> = {
      "package.json": join(root, "package.json"),
      ...assetsIn(join(root, "dist"), "dist"),
    };
    if (!assets["dist/cli.js"]) throw new Error("Build dist/cli.js before building the binary.");
    writeFileSync(
      config,
      JSON.stringify(
        {
          main,
          mainFormat: "module",
          output,
          disableExperimentalSEAWarning: true,
          useVfs: true,
          useCodeCache: false,
          useSnapshot: false,
          assets,
        },
        null,
        2,
      ) + "\n",
    );
    run(process.execPath, ["--build-sea", config], root);
    if (process.platform !== "win32") chmodSync(output, 0o755);
    if (process.platform === "darwin")
      run("/usr/bin/codesign", ["--force", "--sign", "-", output], root);
    // 署名・実行権限を確定してから、配布するバイト列のハッシュを計算する。
    const sha256 = createHash("sha256").update(readFileSync(output)).digest("hex");
    const bytes = statSync(output).size;
    writeFileSync(join(staging, `${name}.sha256`), `${sha256}  ${name}\n`);
    renameSync(output, binary);
    renameSync(join(staging, `${name}.sha256`), checksum);
    return {
      binary,
      checksum,
      bytes,
      sha256,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
    };
  } catch (error) {
    rmSync(binary, { force: true });
    rmSync(checksum, { force: true });
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.stdout.write(JSON.stringify(buildBinary(), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(
      `Failed to build binary: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
