# xan

| | |
|---|---|
| Upstream | https://github.com/medialab/xan |
| License | MIT |
| Required | **yes** — every non-plugin command runs through `xan` |
| Version source | upstream release asset for the declared tag |
| Assets | `xan-<ver>-<platform>[.exe]` (raw binaries, no archives) |

## Why it is required

Easy CSV is a GUI over `xan`. Without it the app can start but no pipeline can
run, which is why the app prompts to install it on first launch instead of
failing later with `plugins executable 'xan' not found`.

## How the binary is produced

`scripts/stage.mjs --platform <platform>` reads this file and tells the release
workflow which upstream asset to pull; the workflow downloads it with
`gh release download` and extracts the single member listed in `plugin.json`:

| Platform | Upstream asset | Member |
|---|---|---|
| windows-x86_64 | `xan-x86_64-pc-windows-msvc.zip` | `xan.exe` |
| macos-aarch64 | `xan-aarch64-apple-darwin.tar.gz` | `xan` |
| macos-x86_64 | `xan-x86_64-apple-darwin.tar.gz` | `xan` |
| linux-x86_64-gnu | `xan-x86_64-unknown-linux-gnu.tar.gz` | `xan` |
| linux-aarch64-gnu | `xan-aarch64-unknown-linux-gnu.tar.gz` | `xan` |

Asset names above were read from `medialab/xan`'s release API — re-check them
whenever the pinned tag moves.

Upstream also publishes `.sha256` files; CI additionally verifies those against
the downloaded archive before staging, so a corrupted mirror cannot poison the
catalog.

## Bumping

1. Pick a **stable** upstream tag (`xan --version` → `0.61.0` style) and set the
   same value in `version` and in every `upstream.tag`.
2. All five platforms must move together: the catalog carries one `version` per
   plugin, so a partial bump would make the app report a version that does not
   match the binary on some platform.
