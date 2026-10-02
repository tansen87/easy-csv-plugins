# DuckDB

| | |
|---|---|
| Upstream | https://github.com/duckdb/duckdb |
| License | MIT |
| Required | no — used by the `duckdb` pipeline command |
| Version source | upstream release tag |
| Assets | `duckdb-<ver>-<platform>[.exe]` (raw binaries, no archives) |

## Two things worth knowing

- **`-version`, not `--version`.** The DuckDB CLI follows the SQLite shell
  convention; `versionArgs` in `plugin.json` records this so the app does not
  hardcode it (it used to be special-cased in Rust).
- **macOS is one binary for both architectures.** Upstream ships
  `duckdb_cli-osx-universal.zip`; `macos-aarch64` and `macos-x86_64` therefore
  point at the same upstream asset but are staged as separate files, because the
  app resolves a different platform directory per architecture. The macOS CI job
  downloads it once and copies it twice.
- The version tag carries a `v` prefix upstream (`v1.5.6`) while the catalog's
  `version` does not (`1.5.6`) — the app compares semantically, but keep the
  convention so the UI reads naturally.

## Version output

`duckdb -version` prints `v1.5.6 (Variegata) d8cdaa33fd`, not a bare version.
The plugin line in Settings shows this raw string (the app only shells out for
display); the catalog `version` is what update checks compare.

## Size

~37 MB per platform, the largest asset we redistribute. The app checks free
space before downloading and shows progress, because this is a visible wait on a
slow connection.
