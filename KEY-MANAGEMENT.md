# 签名密钥管理

清单签名密钥是这套发布链里**唯一不可重建**的东西:代码、脚本、workflow 都在 git 里,
公钥已经在仓库里,但私钥一旦丢失,你只能用**新密钥**重签 —— 而那意味着所有已装的应用都要
先更新一版才能继续信任新清单。

本文是这份密钥的说明书 + 备份清单 + 轮换步骤。**换设备、交接、出事时照这份走。**

---

## 1. 这把钥匙是什么

| | |
|---|---|
| 文件 | `~/.tauri/easycsv-plugins.key`(约 348 字节的 minisign 私钥,**无口令**) |
| 公钥 | `plugin-signing.pub`(**已提交在本仓库**,应用内嵌的就是它) |
| 密钥 ID | `8A6B192E69C38AE4`(公钥里那行 `untrusted comment: minisign public key: …` 的后半段) |
| 签什么 | `catalog.json` → `catalog.json.sig`(base64 包裹的 minisign 签名) |
| 谁验签 | 应用侧用 `minisign-verify` 验,公钥来自 `plugin-signing.pub` |
| 和 app 更新器密钥的关系 | **完全独立**。更新器用的是 `~/.tauri/easycsv-updater.key` + `tauri.conf.json` 里的 `plugins.updater.pubkey`。两把钥匙分开是刻意的:插件仓库的 CI 因此**没有**伪造应用更新的能力 |

### 放在哪

默认就在 `~/.tauri/easycsv-plugins.key`(Tauri CLI 的约定位置,和更新器密钥同目录)。想换地方,
用 `PLUGIN_SIGNING_KEY_PATH` 环境变量或 `--private-key-path` 指定,`sign-catalog.mjs` 与
`key-status.mjs` 都认;CI 里用的是仓库 secret,不依赖这个路径。

- ❌ **绝对不要放进应用的 `EasyCsv` 目录**(Windows/Linux 上那就是安装目录)。卸载器的
  「删除应用数据」会**递归删掉整个文件夹** —— 一次再普通不过的卸载就能销毁唯一不可重建的东西。
  而且那个目录会被更新覆盖、被用户整理、被整体打包分享。
- ❌ 不要放进任何 git 仓库里(`.gitignore` 已挡 `*.key`,但别依赖它)。
- ⚠️ 备份/恢复要**逐字节复制整个文件**:它本身是 base64 包裹的(解开后是
  `untrusted comment: rsign encrypted secret key` + 又一层 base64),把解码后的文本粘回去会得到
  一把**不可用**的钥匙 —— 而 `tauri signer` 只会报解不开,不会告诉你粘错了哪一层。

### 找不到 / 拿不准手里这把对不对

```bash
node scripts/key-status.mjs          # 会用哪把、在不在、是不是那种格式
node scripts/key-status.mjs --prove  # 签一个探针文件,再用仓库公钥验签 —— 唯一可靠的「是否配对」证明
```

`--prove` 用的是 app 将来验签的同一个 crate,所以它说 OK 就是真的 OK。**为什么不能靠比对文件判断**:
私钥是 minisign **加密**过的 secret key(scrypt,即使无口令也加密),密钥 ID 在密文里读不出来。

## 2. 四个位置,能力不同(这是全文最重要的一张表)

| 位置 | 现在有吗 | 能签名吗 | 能取回密钥**本身**吗 |
|------|---------|---------|-------------------|
| 本机 `~/.tauri/easycsv-plugins.key` | ✅ | ✅ 本地签 | ✅ |
| GitHub 仓库 secret `PLUGIN_SIGNING_KEY` | ✅(2026-09-27 配置) | ✅ **CI 签** | ❌ 写入后**永久不可读** |
| 密码管理器(建议现在就做) | ❌ | ❌ | ✅ 换设备的关键 |
| 离线介质 / 纸质(建议现在就做) | ❌ | ❌ | ✅ 兜底 |

> 注意第二行:**只要能进这个仓库的 Actions,就永远签得出清单** —— 哪怕本机那份没了。
> 所以「本机丢失」本身不是灾难,真正的灾难是「本机没了 **且** 仓库/secret 也没了」。

## 3. 万一真的丢了,到底坏什么(别把它想成世界末日)

按丢失范围分三种情况:

**A. 只丢本机文件,仓库和 secret 还在** → **对用户零影响**。CI 照常签、照常发。
你只是不能在新机器上本地签名/联调,而且这份密钥的值再也取不出来了(secret 不可读)。

**B. 本机 + secret 都没了(仓库被删、账号丢失、secret 被误删)** → 只能用新密钥重签:

1. 生成新密钥 → 加进 `plugin-signing.pub`(支持多把,见 §5)→ 发一版**应用**更新;
2. 把 CI 的 secret 换成新密钥 → 重新发一次 catalog release(`catalog-<日期>`,记得 `--latest`);
3. 已更新的用户:一切照旧;
4. **尚未更新**的老版本应用:验签失败 → **应用内一键安装暂时不可用**。但它们不是砖:插件目录/`PATH` 的手动放置路径**不经过清单**,所以
   - 已装好的插件**继续正常工作**;
   - 用户仍可手动下载二进制放进 `<数据目录>/plugins/<平台>/`;
   - 用户仍能收到**应用本体**的更新(那是另一把钥匙签的,见 §1)——更新完一键安装就恢复了。

**C. 丢了但有人拿到了私钥** → 视为泄露,按 §5 轮换,并且**要先**轮换再发下一版 catalog。

## 4. 现在就把备份做掉(10 分钟)

**第 1 步:确认这把钥匙现在真能用**(避免把一把坏钥匙备份出去)

```bash
cd easy-csv-plugins
node scripts/build-catalog.mjs --base-url http://127.0.0.1:8099 --out catalog.local.json
node scripts/sign-catalog.mjs catalog.local.json --tauri ../easy-csv/node_modules/.bin/tauri
# 期望:写出 catalog.local.json.sig 且不报错
```

**第 2 步:进密码管理器**(推荐 · 换设备最省事 —— 它会自动同步,也不会像文件那样被忘在某个角落)

```bash
# 复制到剪贴板后粘贴为「安全笔记 / Secure Note」,标题写 easycsv-plugins signing key
clip < ~/.tauri/easycsv-plugins.key
```

笔记里一并写上:用途(签 easy-csv-plugins 的 catalog)、密钥 ID `8A6B192E69C38AE4`、
关联仓库 `tansen87/easy-csv-plugins`、以及「无口令」。

**第 3 步:一份离线兜底**(U 盘 / 加密压缩包 / 甚至打印出来 —— 只有 348 字节)

**第 4 步:验证备份有效**(从备份粘回临时文件,再签一次并验签)

```bash
# 把笔记内容粘到 /tmp/restored.key,然后:
node scripts/sign-catalog.mjs catalog.local.json --private-key-path /tmp/restored.key --tauri ../easy-csv/node_modules/.bin/tauri
APP=../easy-csv
rustc --edition 2021 -L dependency=$APP/src-tauri/target/debug/deps \
      --extern minisign_verify=$(ls $APP/src-tauri/target/debug/deps/libminisign_verify-*.rlib | head -1) \
      scripts/verify-signature.rs -o /tmp/verify-signature
/tmp/verify-signature catalog.local.json catalog.local.json.sig plugin-signing.pub
# 期望:SIGNATURE OK + tamper check OK
rm -f /tmp/restored.key          # 验完删掉临时副本
```

**别做的事**:不要 `git add` 这个文件(`.gitignore` 已挡 `*.key` / `*.key.pub`);不要贴进 issue、
聊天、邮件或截图;不要删掉仓库里那个 secret。

## 5. 换设备 / 轮换密钥

**换设备**只需要两样东西:仓库(在 GitHub 上)+ 私钥(从密码管理器取)。没有别的本地状态。

**轮换**(密钥泄露,或想定期更换):

1. 生成新密钥:`tauri signer generate -w ~/.tauri/easycsv-plugins-2027.key --ci`
2. **先**把新公钥追加进 `plugin-signing.pub`(见下)并发一版**应用**更新
   —— 这一步让新版本的应用同时接受新旧两把钥匙;
3. 等应用更新铺开一些,再把 CI secret 换成新私钥,之后用新钥匙签 catalog;
4. 旧钥匙可以从 `plugin-signing.pub` 里移除(等老版本应用基本退场后再做);
5. 新私钥同样按 §4 备份,旧私钥标注「已退役」保留,不要直接删。

> **因此应用侧必须支持多把公钥**:`plugin-signing.pub` 允许放多行(base64,每行一把),
> 验签时逐行尝试、任一通过即接受。这把「轮换会不会把老用户锁死」变成「取决于他们有没有更新过
> 应用」,是这套方案里最便宜的保险。见主仓库设计稿 023 §3.3。

## 6. 事后自查(任何时候都能做)

```bash
# 线上清单现在是不是还能用本仓库的公钥验过?
curl -sLO https://github.com/tansen87/easy-csv-plugins/releases/latest/download/catalog.json
curl -sLO https://github.com/tansen87/easy-csv-plugins/releases/latest/download/catalog.json.sig
/tmp/verify-signature catalog.json catalog.json.sig plugin-signing.pub
```

期望 `SIGNATURE OK` + `tamper check OK`。若失败:要么有人在中间替换了清单(哈希也会对不上),
要么正在轮换密钥但应用还没更新 —— 先查 `git log plugin-signing.pub` 和最近的 catalog release。
