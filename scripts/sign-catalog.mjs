#!/usr/bin/env node
/**
 * Sign a catalog with the Tauri CLI's signer.
 *
 * The output is `<file>.sig` holding **base64 of the minisign signature** — the
 * exact shape the app verifies (see `tauri-plugin-updater`'s `verify_signature`):
 *
 *   PublicKey::decode(base64_decode(pubkey))
 *     .verify(catalog_bytes, Signature::decode(base64_decode(sig)), true)
 *
 * Using the same tool as the app's updater keeps one code path for generating
 * and one for verifying, instead of two half-compatible ones.
 *
 * Usage:
 *   node scripts/sign-catalog.mjs [file] [--private-key-path PATH] [--tauri PATH] [--password PW]
 *
 *   file                defaults to catalog.json
 *   --private-key-path  defaults to $PLUGIN_SIGNING_KEY_PATH or ~/.tauri/easycsv-plugins.key
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { file: "catalog.json" };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--private-key-path") args.keyPath = argv[++i];
    else if (arg === "--tauri") args.tauri = argv[++i];
    else if (arg === "--password") args.password = argv[++i];
    else if (arg.startsWith("-")) throw new Error(`unknown argument: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 0) args.file = positional[0];
  args.keyPath =
    args.keyPath || process.env.PLUGIN_SIGNING_KEY_PATH || join(homedir(), ".tauri", "easycsv-plugins.key");
  args.tauri = args.tauri || process.env.TAURI_CLI || "npx";
  args.password = args.password ?? process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
  return args;
}

function fail(message) {
  console.error(`sign-catalog: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const file = resolve(ROOT, args.file);

if (!existsSync(file)) fail(`${file} does not exist — run build-catalog.mjs first`);
if (!existsSync(args.keyPath)) {
  fail(
    `private key not found at ${args.keyPath}\n` +
      `  generate one:  tauri signer generate -w ${args.keyPath} --ci\n` +
      `  then keep a backup: losing it means no further catalog can ever be published`,
  );
}

// `npx` needs the package name; a direct path to the CLI binary is used as-is.
const command = args.tauri.endsWith("npx") ? args.tauri : args.tauri;
const commandArgs = args.tauri.endsWith("npx")
  ? ["--no-install", "tauri", "signer", "sign", file, "--private-key-path", args.keyPath]
  : ["signer", "sign", file, "--private-key-path", args.keyPath];

const result = spawnSync(command, commandArgs, {
  cwd: ROOT,
  stdio: ["ignore", "inherit", "inherit"],
  shell: process.platform === "win32",
  env: {
    ...process.env,
    // An empty password must still be *set*: with the variable missing, the
    // signer waits for input forever on a key that has no password.
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: args.password,
  },
});

if (result.status !== 0) fail(`signer exited with ${result.status}`);

const sigPath = `${file}.sig`;
if (!existsSync(sigPath)) fail(`signer reported success but ${sigPath} is missing`);

const sig = readFileSync(sigPath, "utf8").trim();
console.log(`sign-catalog: wrote ${sigPath} (${sig.length} base64 chars)`);
console.log(
  "sign-catalog: audit it without our tooling:\n" +
    `  base64 -d "${sigPath}" > /tmp/catalog.minisig\n` +
    `  minisign -V -p plugin-signing.pub -m "${args.file}" -x /tmp/catalog.minisig`,
);
