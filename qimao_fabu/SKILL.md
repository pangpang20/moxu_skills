---
name: qimao_fabu
description: 把本地小说发布到七猫。当用户说「把本地《xxx》小说发布到七猫《yyy》小说中」「同步章节到七猫」「把墨序的书搬到七猫」时使用。从墨序本地写作台(127.0.0.1:4317)读取已定稿章节，自动接上七猫作者后台已发布的最后一章，新建章节并存入草稿箱；只存草稿，绝不自动发布，由用户人工点发布。
---

# qimao_fabu · 本地小说 → 七猫发布

把「墨序本地写作台」里已定稿的章节，自动搬运到七猫（奇猫）作者后台的草稿箱。
用户在七猫后台人工点「立即发布」。

## 触发方式

用户说类似这样的话即可运行：

- 「把本地《春山不渡》小说发布到七猫《山河不许人间源》小说中，同步 5 章」
- 「把墨序的新章节同步到七猫」
- 「接着上次继续同步章节」

## 运行方法

技能目录：`~/.workbuddy/skills/qimao_fabu/`，在该目录下执行：

```bash
# 标准用法：同步接下来的 5 章
node scripts/sync.js --src 春山不渡 --dst 山河不许人间源 --count 5

# 指定章节范围
node scripts/sync.js --src 春山不渡 --dst 山河不许人间源 --from 28 --to 30

# 查看墨序已有章节（只读）
node scripts/source.js --book 春山不渡

# 删除七猫草稿箱里的草稿（先预览，加 --do 执行）
node scripts/cleanup.js --dst 山河不许人间源 --title 章节名
node scripts/cleanup.js --dst 山河不许人间源 --title 章节名 --do
```

参数说明：

- `--src` 墨序里的书名（默认 春山不渡）
- `--dst` 七猫里的书名（默认 山河不许人间源），脚本自动在七猫作品列表里按书名定位
- `--count N` / `--from N --to M` 必须指定其一，防止误全量同步
- `--dry-run` 填好但不点「更新草稿」；`--headed` 弹窗观察

运行完会打印同步报告（保存/跳过/失败清单），详细数据在 `.cache/sync-report.json`。

## 首次使用 / 登录态失效

1. `node scripts/login.js` 弹出真实 Chrome 窗口
2. 用户手动登录两个站：墨序（账号密码）、七猫作者后台（手机验证码）
3. 登录态存 `.profile/`，之后免登录；七猫 Cookie 过期后重跑即可

## 行为约定（重要，对用户承诺过的）

1. **只存草稿，绝不发布**。只点「更新草稿」，从不碰「立即发布 / 定时发布」。
2. **自动接续**：读七猫「章节管理」最大章号 + 「草稿箱」已有草稿，从下一章接着同步；标题已存在的自动跳过。
3. **章号强校验**：编辑器自动分配的章号必须与墨序章节号一致，否则跳过报警，绝不重号错位。
4. **正文 1000–50000 字**：不足 1000 字的章不保存，列入失败清单。
5. **标题 ≤20 字**：自动去「第X章」前缀（七猫自己加序号），超长截断。

## 已知坑（务必记住）

- ⚠️ 七猫编辑器**打开并填入内容就会自动存云端草稿并占用章号**，没有真正的"只填不存"。
  dry-run 也会留草稿；失败留下的错号草稿要用 cleanup.js 删掉再重跑，否则后续章整体错位。
- 「永久删除」按钮有 **2 秒倒计时**，脚本会等它解锁再点。
- 章号读取节点：`.chapter-index-input-mirror` 或 `.chapter-index-input-input input`。

## 结构

```
scripts/login.js     首次登录 + 页面结构探测
scripts/source.js    从墨序读章节（/api/books/{slug}/reader 接口）
scripts/sync.js      主流程：定位书 → 比对 → 新建章节 → 填写 → 存草稿
scripts/cleanup.js   按标题删草稿
scripts/probe.js     通用页面探测（截图 + DOM 概览），改版时重新摸结构
lib/common.js        工具函数、选择器配置
lib/source.js        墨序 API 封装
lib/qimao.js         七猫书名→书籍id 解析（结果缓存在 .cache/target-books.json）
.profile/            浏览器持久化登录态（勿删）
.cache/              同步报告、失败截图、书籍缓存
```

## 排障

- **提示需登录** → 重跑 `scripts/login.js`
- **选择器失效（七猫改版）** → 跑 `node scripts/probe.js` 看 `.probe/` 截图与 outline，更新 sync.js 选择器
- **章号对不上** → 草稿箱有残留占号草稿，cleanup.js 删掉再跑
