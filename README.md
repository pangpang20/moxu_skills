# moxu_skills

把墨序（本地写作台）中的小说自动发布到各大小说网的技能仓库。

每个子目录是一个独立技能，可单独安装/使用。

## 技能列表

| 技能 | 目标平台 | 说明 |
| --- | --- | --- |
| [qimao_fabu](./qimao_fabu) | 七猫（奇猫）作者后台 | 自动接续已发布章节，新建章节并存入草稿箱，仅存草稿不自动发布 |

## 安装

```bash
git clone git@github.com:pangpang20/moxu_skills.git
cd moxu_skills/qimao_fabu
npm install            # 只需安装 playwright-core，复用本机 Chrome/Edge，不下载浏览器内核
```

前置条件：

- 本地已运行墨序写作台（默认 `https://127.0.0.1:4317`）
- 本机装有 Chrome 或 Edge
- Node.js 18+

## 快速开始（以七猫为例）

```bash
cd qimao_fabu

# 1) 首次登录：弹出真实浏览器，手动登录墨序 + 七猫作者后台，登录态存到 .profile/
node scripts/login.js

# 2) 同步接下来的 5 章（自动从七猫已发布的最新一章接着上，只存草稿）
node scripts/sync.js --src 春山不渡 --dst 山河不许人间源 --count 5
```

## 安全说明

- 登录态、缓存、探测截图均已加入 `.gitignore`，不会进入仓库
- 所有技能默认**只写草稿**，发布动作始终由人工在平台后台完成
- 脚本仅在本地运行，不上传任何作品内容到第三方服务

## License

MIT
