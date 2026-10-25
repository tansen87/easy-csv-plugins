# DuckDB

| | |
|---|---|
| Upstream | https://github.com/duckdb/duckdb |
| License | MIT |
| Required | no — used by the `duckdb` pipeline command |
| Version source | upstream release tag |
| Assets | `duckdb-<ver>-<platform>[.exe]` (raw binaries, no archives) |

## Things worth knowing

- **`-version`, not `--version`.** The DuckDB CLI follows the SQLite shell
  convention; `versionArgs` in `plugin.json` records this so the app does not
  hardcode it (it used to be special-cased in Rust).
- **macOS ships one binary per architecture.** Since 2.0.0 upstream publishes
  `duckdb-cli-osx-arm64.tar.gz` and `duckdb-cli-osx-amd64.tar.gz` instead of the
  earlier universal build, so `macos-aarch64` and `macos-x86_64` point at
  different assets.
- **2.0.0 moved from `.zip` to `.tar.gz`.** The workflows extract by extension,
  so no step changes; only the asset names in `plugin.json` do.
- The version tag carries a `v` prefix upstream (`v2.0.0`) while the catalog's
  `version` does not (`2.0.0`) — the app compares semantically, but keep the
  convention so the UI reads naturally.

## Version output

`duckdb -version` prints `v2.0.0 (Cyanoptera) d54cbbe3df`, not a bare version.
The plugin line in Settings shows this raw string (the app only shells out for
display); the catalog `version` is what update checks compare.

## Size

~60-78 MB per platform (the extracted CLI, not the ~20 MB upstream tarball),
the largest asset we redistribute. The app checks free space before downloading
and shows progress, because this is a visible wait on a slow connection.
