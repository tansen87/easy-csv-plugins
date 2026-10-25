# AGENTS.md — 插件版本更新手册

面向 AI 代理.用户说「把 `<插件>` 更新到 `<版本>`」时按本文件执行,**不要凭记忆猜上游资产名**：
DuckDB 在 2.0.0 就把 `duckdb_cli-*.zip` 换成了 `duckdb-cli-*.tar.gz`,且取消 macOS universal 包.

## 0. 三条铁律

1. **不要手改 `catalog.json` / `catalog.json.sig`.** 前者由 `scripts/build-catalog.mjs` 从实际字节算
   `size`/`sha256`/`urls`,后者要用 CI 的 `PLUGIN_SIGNING_KEY` 签；手改必然 hash 不符、签名失效.
2. **`plugins/<name>/plugin.json` 是唯一手工维护的版本来源.** 改完必须提交并推到 `main` 再触发工作流,
   否则 CI checkout 到的是旧版本,等于发布旧版.
3. **五个平台共用一个 `version`.** app 每个插件只显示一个版本,catalog 绝不能混版本.

## 1. 仓库结构

| 路径 | 谁维护 | 说明 |
|---|---|---|
| `plugins/<name>/plugin.json` | 手工 | 版本 + 每平台上游下载配方（`stage.mjs` 的唯一输入） |
| `plugins/<name>/README.md` | 手工 | 上游来源、注意事项、版本串、体积 |
| `catalog.json` / `.sig` | CI | 生成 + 签名,CI 用 `git add -f` 回写 main（jsDelivr 镜像用） |
| `dist/<platform>/` | CI 或本地 | 暂存解压后的二进制,gitignore |
| `scripts/stage.mjs` | — | 按平台输出 `<plugin>\t<repo>\t<tag>\t<asset>\t<member>\t<file>` |
| `scripts/build-catalog.mjs` | — | `dist/` → catalog（`--require-all` 供 CI） |
| `scripts/sign-catalog.mjs` | — | catalog → base64 minisign,`.sig` |
| `.github/workflows/release.yml` | — | 唯一的发布入口 |

平台键必须是这五个,不能自造：`windows-x86_64`、`macos-aarch64`、`macos-x86_64`、
`linux-x86_64-gnu`、`linux-aarch64-gnu`.

## 2. 先判定上游类型

看 `assets.<platform>.upstream.kind`：

- `github`（xan、duckdb）→ 走 §3.
- `cargo`（pinyin）→ 二进制在**另一个仓库**构建,先看 §5.

## 3. 更新 github 型插件（主流程）

### Step 1 — 查上游 release

```bash
gh api repos/<owner>/<repo>/releases/tags/<tag> \
  --jq '.tag_name, .prerelease, (.assets[] | "\(.name)\t\(.size)")'
```

- `prerelease` 必须为 `false`,否则让用户确认.
- **tag 前缀照抄上游**：xan 是 `0.61.0`（无 v）,duckdb 是 `v2.0.0`（有 v）.`version` 字段一律不带 v.
- 资产清单以 API 为准,不要沿用旧版本的文件名.

### Step 2 — 核对资产名与包内成员名（最容易翻车的一步）

```bash
# .tar.gz
tar -tzf <asset>          # 或 tar -tvzf 看大小
# .zip
unzip -l <asset>
```

- `member` 必须与包内路径**完全一致**（`duckdb.exe` vs `duckdb`）.
- `file` 是 app 落盘的文件名,Windows 带 `.exe`；它同时决定 catalog URL 后缀,不要随意改.
- Linux 选 **gnu/glibc** 资产,不要 `-musl`.
- macOS 上游可能给 `universal`,也可能分 `osx-arm64` / `osx-amd64`；分架构时两个 mac 平台指向
  不同资产（各自更小）,不要为了省事都指 universal.
- Windows 上解压后实跑一次确认 `versionArgs`：

```powershell
& .\dist\windows-x86_64\<file> --version   # 或 -version,以 plugin.json 的 versionArgs 为准
```

输出通常是 `v2.0.0 (Cyanoptera) d54cbbe3df` 这种长串,正常；app 只原样显示.

### Step 3 — 改 `plugin.json`

只改这些字段：`version`、每个平台 `upstream.tag`、必要时 `upstream.asset`.
`file` 与 `versionArgs` 不动,除非 Step 2 证明上游变了（DuckDB 的 `-version` 就与 xan 的 `--version` 不同）.

### Step 4 — 同步 `plugins/<name>/README.md`

会过期的是「事实」而非流程：版本串、资产形态（zip/tar.gz、是否分架构）、体积、
`-version` 示例输出.体积按**解压后的 CLI**写,不是上游压缩包大小.

### Step 5 — 本地检查（两条都必须过）

```bash
node -e "const p=require('./plugins/<name>/plugin.json'); console.log(p.version); for (const [k,v] of Object.entries(p.assets)) console.log(k, v.upstream.tag, v.upstream.asset, v.upstream.member)"

for p in windows-x86_64 macos-aarch64 macos-x86_64 linux-x86_64-gnu linux-aarch64-gnu; do
  node scripts/stage.mjs --platform "$p"
done
```

输出里不能残留旧 tag / 旧资产名,五个平台都要有该插件的记录.

### Step 6 — 提交、推送、发布

```bash
git add plugins/<name>/plugin.json plugins/<name>/README.md
git commit -m "feat(<name>): bump to v<ver>"
git push origin main

gh workflow run release.yml --ref main
gh run watch <run-id> --exit-status          # 失败先看 gh run view <run-id> --log-failed
```

**必须真正推到 main 再触发**；`--ref` 指向的 ref 上没有 bump,CI 构建的就是旧版.

### Step 7 — 收尾验证

```bash
git pull --ff-only       # CI 会把 catalog.json/.sig 提交回 main
node -e "const c=require('./catalog.json');const d=c.plugins.find(p=>p.name==='<name>');console.log(d.version);for(const[k,v]of Object.entries(d.assets))console.log(k,v.size,v.urls[0])"
gh release view <name>-v<ver> --json assets
```

预期：`catalog.json` 里是新版本、五个平台齐全；`<name>-v<ver>` release 里资产名为
`<name>-<ver>-<platform>[.exe]`（由 `build-catalog.mjs` 反推,不能自定义）.

## 4. 工作流做了什么（失败时用来定位）

`stage` ×5 → `publish`：

1. `node scripts/stage.mjs --platform` 生成下载清单；
2. `gh release download` 取包,**按扩展名**解压：`.zip` 用 `unzip -d`,`.tar.gz`/`.tgz` 用 `tar -C`；
   注意 `unzip -d` 会建目标目录,`tar -C` 不会（工作流里已有 `mkdir -p "$tmp/out"`,别删）；
3. `build-catalog.mjs --require-all` 算 `size`/`sha256`/`urls`,缺任何平台直接失败；
4. `ajv` 按 `schema/catalog.schema.json` 校验（`urls` 必须 `https://`）；
5. `sign-catalog.mjs` 签名；
6. 先发各插件 release,再发 `catalog-<date>` 并 `--latest`（顺序不能反,catalog 钉的是资产 URL）；
7. `git add -f catalog.json catalog.json.sig` 提交回 `main`（镜像用）；无变化则不产生空提交.

## 5. cargo 型插件（pinyin）

- 二进制由 CI 从 `tansen87/easy-csv` 的 **main** 构建,这里是 `kind: cargo` + `path` + `target`.
- 只改这里的 `version` 会得到「新版本号 + 旧二进制」.正确顺序：先进 easy-csv 改代码并推 main,
  再 bump 这里的 `version`,然后按 §3 Step 6 发布.
- 这条流水线只认 `plugins/pinyin`,新增 cargo 插件要同时改 `release.yml` 的 `Build pinyin` 步骤.

## 6. 故障对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| `tar: .../out: Cannot open: No such file` | `tar -C` 目标目录不存在 | 确认 `release.yml` 里有 `mkdir -p "$tmp/out"` |
| `gh release download` 报找不到资产 | tag 或资产名错（上游改了命名） | 回 §3 Step 1/2 重新核对 |
| `build-catalog: no staged binary for <name>/<platform>` | 该平台 stage job 失败或资产漏下 | 看 `--log-failed`,修 stage |
| schema validate 失败 | 一般不是 catalog 的问题,而是 `plugin.json` 的 `file`/平台键非法 | 按 schema 修正后重跑 |
| 发布成功但 app 不提示更新 | catalog release 没带 `--latest`,或版本串没变 | 检查 `gh release view --json tagName` 是否为最新 `catalog-*` |

## 7. 不要做的事

- 不手改 catalog、不手动 `gh release upload`、不绕开工作流发布.
- 不改平台键、不改 `file` 名（app 按它落盘并做安全校验）、不在 catalog 里混平台版本.
- 不用本地 `build-catalog.mjs` + `sign-catalog.mjs` 代替发布；那只用于本地联调（见 README,`catalog.local.json` 被 gitignore,且因允许 loopback 而不满足 schema 的 https 要求）.

## 8. 检查清单

- [ ] tag 存在且 `prerelease=false`
- [ ] 五个平台资产名、包内 member 逐一核对过
- [ ] `version` 不带 v,五平台一致
- [ ] README 的过期事实（版本串、资产形态、体积）已改
- [ ] 五个平台 `stage.mjs` 输出无旧值
- [ ] commit 已推 `main`
- [ ] `release.yml` 运行成功
- [ ] `git pull` 后 catalog 内已是新版本
