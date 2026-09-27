# pinyin

| | |
|---|---|
| Source | `tansen87/easy-csv` → `plugins/pinyin-cli` (the app's own crate) |
| License | MIT |
| Required | no — a convenience plugin, the app works without it |
| Version source | `plugins/pinyin-cli/Cargo.toml` |
| Assets | `pinyin-<ver>-<platform>[.exe]` (raw binaries, no archives) |

## How the binary is produced

There is no upstream release to download: CI checks out the app repository and
cross-compiles the crate once per platform (`cargo build --release --target …`).
One runner per OS:

| Platform | Runner | Rust target |
|---|---|---|
| windows-x86_64 | `windows-latest` | `x86_64-pc-windows-msvc` |
| macos-aarch64 | `macos-14` | `aarch64-apple-darwin` |
| macos-x86_64 | `macos-14` | `x86_64-apple-darwin` (cross-compile, same runner) |
| linux-x86_64-gnu | `ubuntu-latest` | `x86_64-unknown-linux-gnu` |
| linux-aarch64-gnu | `ubuntu-latest` | `aarch64-unknown-linux-gnu` (`gcc-aarch64-linux-gnu`) |

`version` here must equal the crate version, not an independent number: the app
shows it next to the plugin name and compares it for updates.

## Bumping

Bump `plugins/pinyin-cli/Cargo.toml` in the app repo, then mirror the value into
`plugin.json` and re-run the release workflow.
