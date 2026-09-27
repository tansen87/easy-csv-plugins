#!/usr/bin/env node
/**
 * Resolve, for one platform, which upstream files must be fetched to stage that
 * platform's plugin binaries. Reads the `plugin.json` files so the workflow
 * never duplicates asset names — a plugin bump is a single file edit.
 *
 * Prints one tab-separated record per asset:
 *
 *   <plugin>  <repo>  <tag>  <asset>  <member>  <target file>
 *
 * `kind: cargo` entries (pinyin) are *not* printed: they are built by the
 * workflow, not downloaded.
 *
 * Usage: node scripts/stage.mjs --platform windows-x86_64
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORMS = [
  "windows-x86_64",
  "macos-aarch64",
  "macos-x86_64",
  "linux-x86_64-gnu",
  "linux-aarch64-gnu",
];

const argv = process.argv.slice(2);
const platformIndex = argv.indexOf("--platform");
const platform = platformIndex >= 0 ? argv[platformIndex + 1] : null;

if (!platform || !PLATFORMS.includes(platform)) {
  console.error(`stage: --platform must be one of ${PLATFORMS.join(", ")}`);
  process.exit(1);
}

let count = 0;
for (const dir of readdirSync(join(ROOT, "plugins"), { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const meta = JSON.parse(readFileSync(join(ROOT, "plugins", dir.name, "plugin.json"), "utf8"));
  const asset = meta.assets?.[platform];
  if (!asset) {
    console.warn(`stage: ${meta.name} has no ${platform} asset — skipped`);
    continue;
  }
  if (asset.upstream?.kind !== "github") continue; // built in CI (pinyin)
  const { repo, tag, asset: upstreamAsset, member } = asset.upstream;
  console.log([meta.name, repo, tag, upstreamAsset, member, asset.file].join("\t"));
  count += 1;
}

if (count === 0) {
  console.warn(`stage: nothing to download for ${platform}`);
}
