#!/usr/bin/env node
/**
 * Answer two questions in one command:
 *   1. which signing key would be used here, and does it exist?
 *   2. does that key actually pair with `plugin-signing.pub` in this repository?
 *
 * The second question cannot be answered by inspecting the files: the private
 * key is a base64 wrapper around a minisign *encrypted* secret key, so its key id
 * is not readable. The only honest answer is to sign something and verify it —
 * which `--prove` does, using the same `minisign-verify` crate the app uses.
 *
 * It never prints key contents.
 *
 * Usage:
 *   node scripts/key-status.mjs [--prove] [--private-key-path PATH] [--tauri CLI] [--app DIR]
 *
 * Resolution order (same as sign-catalog.mjs):
 *   --private-key-path  →  $PLUGIN_SIGNING_KEY_PATH  →  ~/.tauri/easycsv-plugins.key
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_KEY = join(ROOT, "plugin-signing.pub");

function parseArgs(argv) {
  const args = { prove: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--prove": args.prove = true; break;
      case "--private-key-path": args.keyPath = argv[++i]; break;
      case "--tauri": args.tauri = argv[++i]; break;
      case "--app": args.app = argv[++i]; break;
      default: positional.push(argv[i]);
    }
  }
  if (positional.length > 0) throw new Error(`unknown argument: ${positional[0]}`);
  args.keyPath = args.keyPath || process.env.PLUGIN_SIGNING_KEY_PATH || join(homedir(), ".tauri", "easycsv-plugins.key");
  args.tauri = args.tauri || process.env.TAURI_CLI || "npx";
  args.app = args.app || process.env.EASY_CSV_REPO || resolve(ROOT, "..", "easy-csv");
  return args;
}

function base64(input) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Runs a command. `shell` is opt-in and only needed for Windows `.CMD` shims;
 * spawning cmd.exe for everything makes consecutive calls flaky (EBUSY), and
 * with a shell the arguments have to be quoted by hand.
 */
function run(command, commandArgs, { shell = false, stdio = "pipe" } = {}) {
  const args = shell
    ? commandArgs.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg))
    : commandArgs;
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio,
    shell,
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" },
  });
}

/** Retries a spawn while Windows reports the freshly written binary as busy. */
function runWithRetry(command, commandArgs, options, attempts = 5) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = run(command, commandArgs, options);
    const code = result.error?.code;
    if (code !== "EBUSY" && code !== "ETXTBSY" && code !== "EACCES") return result;
    // A brand new .exe can be locked by the antivirus scanner or still held by
    // the linker for a moment; waiting briefly is the standard fix.
    spawnSync(process.platform === "win32" ? "cmd" : "sh", ["/c", process.platform === "win32" ? "timeout /t 1 >nul" : "sleep 1"], { stdio: "ignore" });
  }
  return result;
}

/** Signs a throwaway file with `keyPath` and verifies it against the repo pubkey. */
function proveKeyPairsWithRepo({ keyPath, tauri, app }) {
  const deps = join(app, "src-tauri", "target", "debug", "deps");
  if (!existsSync(deps)) {
    throw new Error(
      `cannot prove the key: ${deps} does not exist.\n` +
        `  Build the app once (cargo check) or pass --app DIR pointing at the easy-csv checkout.`,
    );
  }
  const rlib = readdirSync(deps).find((name) => /^libminisign_verify-.*\.rlib$/.test(name));
  if (!rlib) throw new Error(`cannot prove the key: no libminisign_verify-*.rlib in ${deps}`);

  const dir = mkdtempSync(join(tmpdir(), "easycsv-key-check-"));
  try {
    // Built into the app's target directory rather than the temp dir: that is
    // where build artifacts belong, it is already ignored by git, and on Windows
    // executing a binary freshly written to %TEMP% can fail with EBUSY.
    const ext = process.platform === "win32" ? ".exe" : "";
    const verifier = join(app, "src-tauri", "target", "debug", `easycsv-verify-signature${ext}`);
    const source = join(ROOT, "scripts", "verify-signature.rs");
    if (!existsSync(verifier) || statSync(verifier).mtimeMs < statSync(source).mtimeMs) {
      const compile = run(
        "rustc",
        [
          "--edition", "2021",
          "-L", `dependency=${deps}`,
          "--extern", `minisign_verify=${join(deps, rlib)}`,
          source,
          "-o", verifier,
        ],
        { stdio: "inherit" },
      );
      if (compile.status !== 0) throw new Error("cannot prove the key: rustc failed to build the verifier");
    }

    const probe = join(dir, "probe.json");
    writeFileSync(probe, `{"probe":"${Date.now()}"}\n`);

    const tauniArgs = tauri.endsWith("npx")
      ? ["--no-install", "tauri", "signer", "sign", probe, "--private-key-path", keyPath]
      : ["signer", "sign", probe, "--private-key-path", keyPath];
    const signed = run(tauri, tauniArgs, { shell: true, stdio: "inherit" });
    if (signed.error) throw new Error(`cannot prove the key: ${signed.error.message}`);
    if (signed.status !== 0) throw new Error("cannot prove the key: signing the probe failed");

    const verified = runWithRetry(verifier, [probe, `${probe}.sig`, PUBLIC_KEY]);
    if (verified.error) throw new Error(`could not run the verifier: ${verified.error.message}`);
    if (verified.status !== 0) {
      return { ok: false, detail: (verified.stdout || verified.stderr || "").trim() };
    }
    return { ok: true, detail: (verified.stdout || "").trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

console.log(`resolved key : ${args.keyPath}`);
console.log(`repo pubkey  : ${existsSync(PUBLIC_KEY) ? PUBLIC_KEY : "(missing!)"}`);

if (!existsSync(args.keyPath)) {
  console.log("status       : MISSING — nothing can be signed from this machine");
  console.log("");
  console.log("Restore it from your password manager or offline copy. If it is truly gone,");
  console.log("do NOT silently generate a replacement: a new key needs a new public key and");
  console.log("an app release first. See KEY-MANAGEMENT.md §5.");
  process.exit(1);
}

const stats = statSync(args.keyPath);
console.log(`status       : present (${stats.size} bytes, modified ${stats.mtime.toISOString().slice(0, 10)})`);

const inner = base64(readFileSync(args.keyPath, "utf8").trim()).toString("utf8").trim().split("\n");
console.log(`key kind     : ${inner[0].replace(/^untrusted comment:\s*/, "")}`);

if (!args.prove) {
  console.log("pairing      : not checked (the key id is inside the encrypted payload)");
  console.log("");
  console.log("Run with --prove to sign a throwaway file and verify it against the repo pubkey.");
} else {
  console.log("pairing      : proving… (sign a probe, then verify with plugin-signing.pub)");
  try {
    const { ok, detail } = proveKeyPairsWithRepo(args);
    console.log(`pairing      : ${ok ? "OK — this key pairs with plugin-signing.pub" : "MISMATCH"}`);
    if (detail) console.log(detail.split("\n").map((line) => `               ${line}`).join("\n"));
    if (!ok) {
      console.log("");
      console.log("Signing with this key would produce a catalog every installed app rejects.");
    }
  } catch (error) {
    console.log(`pairing      : could not check — ${error.message}`);
    console.log("");
    console.log("Some locked-down environments refuse to execute a freshly compiled binary from");
    console.log("this process. The same check by hand:");
    console.log(`  rustc --edition 2021 -L dependency=${args.app}/src-tauri/target/debug \\`);
    console.log("        --extern minisign_verify=$(ls " + args.app + "/src-tauri/target/debug/deps/libminisign_verify-*.rlib | head -1) \\");
    console.log("        scripts/verify-signature.rs -o /tmp/verify-signature");
    console.log(`  <tauri> signer sign probe.json --private-key-path "${args.keyPath}"`);
    console.log("  /tmp/verify-signature probe.json probe.json.sig plugin-signing.pub");
    console.log("Expect SIGNATURE OK; anything else means the key does not match the public key.");
  }
}

console.log("");
console.log("Backups (KEY-MANAGEMENT.md §2 — a GitHub secret can sign but can never be read back):");
console.log("  [ ] password manager — the only copy that survives a disk wipe and is easy to find");
console.log("  [ ] offline media / paper");
console.log("");
console.log("Copy the file verbatim when backing up: it is a base64 wrapper, so pasting the");
console.log("decoded text back would produce an unusable key.");
console.log("Never place it inside the app's data directory: the NSIS uninstaller's");
console.log('"delete app data" option removes that whole folder recursively.');
