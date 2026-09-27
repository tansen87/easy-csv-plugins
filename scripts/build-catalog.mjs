#!/usr/bin/env node
/**
 * Build `catalog.json` from `plugins/<name>/plugin.json` + staged binaries.
 *
 * The catalog is the only thing the app trusts: every size and sha256 in it is
 * computed here from the bytes that will actually be published, so a tampered
 * mirror or proxy cannot change what the app installs.
 *
 * Usage:
 *   node scripts/build-catalog.mjs [options]
 *
 *   --repo OWNER/REPO   release repository for the asset URLs (or $GITHUB_REPOSITORY)
 *   --base-url URL      use `URL/<platform>/<file>` instead of GitHub release URLs
 *                       (local end-to-end testing)
 *   --out FILE          output path (default: catalog.json)
 *   --dist DIR          staging root (default: dist)
 *   --require-all       fail when a declared platform has no staged binary
 *                       (CI uses this; local runs want to build a partial catalog)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function parseArgs(argv) {
  const args = { dist: "dist", out: "catalog.json", requireAll: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--dist") args.dist = argv[++i];
    else if (arg === "--require-all") args.requireAll = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  args.repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (!args.repo && !args.baseUrl) {
    throw new Error("provide --repo OWNER/REPO (or GITHUB_REPOSITORY), or --base-url for local testing");
  }
  return args;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function assetUrls(args, plugin, platform, file) {
  if (args.baseUrl) {
    return [`${args.baseUrl.replace(/\/$/, "")}/${platform}/${file}`];
  }
  return [
    `https://github.com/${args.repo}/releases/download/${plugin.name}-v${plugin.version}` +
      `/${plugin.name}-${plugin.version}-${platform}${file.endsWith(".exe") ? ".exe" : ""}`,
  ];
}

function fail(message) {
  console.error(`build-catalog: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const distDir = resolve(ROOT, args.dist);
const pluginDirs = readdirSync(join(ROOT, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const plugins = [];
const missing = [];

for (const dir of pluginDirs) {
  const metaPath = join(ROOT, "plugins", dir, "plugin.json");
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));

  if (!NAME_RE.test(meta.name || "")) {
    fail(`plugins/${dir}/plugin.json: name "${meta.name}" must match ${NAME_RE}`);
  }
  if (meta.name !== dir) {
    fail(`plugins/${dir}/plugin.json: name "${meta.name}" must equal its directory name`);
  }
  if (!meta.version) fail(`plugins/${dir}/plugin.json: version is required`);
  for (const platform of Object.keys(meta.assets || {})) {
    if (!PLATFORMS.includes(platform)) {
      fail(`plugins/${dir}/plugin.json: unknown platform "${platform}"`);
    }
  }

  const assets = {};
  for (const [platform, asset] of Object.entries(meta.assets || {})) {
    const staged = join(distDir, platform, asset.file);
    if (!existsSync(staged)) {
      missing.push(`${meta.name}/${platform}`);
      if (args.requireAll) fail(`no staged binary for ${meta.name} on ${platform} (${staged})`);
      continue;
    }
    const size = statSync(staged).size;
    if (size === 0) fail(`${staged} is empty`);
    assets[platform] = {
      file: asset.file,
      size,
      sha256: sha256(staged),
      urls: assetUrls(args, meta, platform, asset.file),
    };
  }

  if (Object.keys(assets).length === 0) {
    console.warn(`build-catalog: skipping ${meta.name} — nothing staged`);
    continue;
  }

  plugins.push({
    name: meta.name,
    title: meta.title || meta.name,
    description: meta.description || "",
    homepage: meta.homepage || "",
    license: meta.license || "",
    required: meta.required === true,
    version: meta.version,
    versionArgs: meta.versionArgs || ["--version"],
    assets,
  });
}

// Required plugins first, then a stable alphabetical order: the catalog is
// signed, so it must not churn just because the filesystem enumerated
// differently.
plugins.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));

if (plugins.length === 0) fail("no plugin had a staged binary — nothing to publish");

const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  plugins,
};

const outPath = resolve(ROOT, args.out);
writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);

for (const plugin of plugins) {
  const platforms = Object.keys(plugin.assets);
  console.log(
    `${plugin.required ? "*" : " "} ${plugin.name}@${plugin.version}  ` +
      `${platforms.length} platform(s): ${platforms.join(", ")}`,
  );
}
if (missing.length > 0) {
  console.warn(`build-catalog: ${missing.length} platform(s) not staged: ${missing.join(", ")}`);
}
console.log(`build-catalog: wrote ${outPath}`);
