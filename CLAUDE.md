# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库概览

纯前端小游戏合集(Game Arcade),零依赖、零构建,同时提供微信小程序版。网页版部署在 GitHub Pages:https://bilibilixxm.github.io/game-arcade/(main 分支 legacy 构建)。

## 常用命令

```bash
# 俄罗斯方块引擎单测(纯 Node,无测试框架,39 项断言直接跑)
node tools/tetris-engine.test.js

# 重新生成资产(纯 Node 零依赖)
node tools/gen-icons.js     # icons/icon-{180,192,512}.png(马赛克手柄像素画)
node tools/gen-sounds.js    # miniprogram/assets/sounds/{schulte,tetris}/*.wav

# 本地服务器(PWA/SW 测试需要 http;8123 被本机 Home Assistant 占用,用 8917)
python3 -m http.server 8917
```

**Playwright UI 测试**(schulte 35 项 / lobby 7 项 / tetris 36 项 / PWA 14 项)不进仓库,放在 `/tmp/schulte-test/`(test.js、lobby-test.js、tetris-test.js、pwa-test.js),用 `playwright-core` 指向本机 chrome-headless-shell:

```bash
EXE=~/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell
# schulte/tetris/lobby 测试用 file:// URL;PWA 测试需先起 http.server 8917
```

若 `/tmp/schulte-test/` 已被清理,需按上述断言数量重写测试脚本(它们覆盖:PWA 预缓存计数、离线可玩、iOS 安装提示三态、tetris 键盘+触控流、canvas 渲染位置像素断言、大厅与子页 localStorage 联动)。

小程序无自动化测试;提交前做静态校验:所有 JSON 可解析、`node --check` 每个 JS、WXML 里的 bind 方法与 data 字段和 JS 交叉核对(历史会话用临时 node 脚本完成)。

## 架构

### 双平台共用引擎(最重要的约定)

`games/tetris/engine.js` 是**规范源**:UMD 纯逻辑引擎(7-bag、SRS 踢墙、Hold、锁定延迟、计分),不碰 DOM/wx。`miniprogram/libs/tetris-engine.js` 是它的**手动同步副本**。改引擎必须:①同步副本(diff 两文件从 `(function (root, factory)` 起应完全一致);②跑 `node tools/tetris-engine.test.js`。

引擎注意点:
- `pieceCells()` 返回**绝对坐标**(曾因 UI 层把它当相对坐标再叠加 `current.y` 导致方块画偏,两平台同踩)
- `lastDrop = -1` 哨兵(falsy 0 问题);`reset({level})` 支持起始难度,升级取 `max(startLevel, floor(lines/10)+1)`
- 引擎无回调;UI 层用 watch 模式判定锁定/消行/升级:动作前 `beginWatch()` 记录 `current` 引用与 lines/level,动作后 `endWatch()` 对比(hold 走 `endWatch(false)` 不出锁定音)

### 每游戏独立目录 + 三层共享件

```
games/<name>/{index.html, *.css, *.js}   # 各游戏完全独立,文件引用用相对路径(./、../../)
index.html + lobby.css                    # 大厅:读 localStorage 在卡片上显示各游戏最高分(data-best-key)
sw.js + manifest.json + icons/            # PWA 层,作用于全站
miniprogram/pages/{home,schulte,tetris}/  # 小程序:home 大厅 → wx.navigateTo
```

新增游戏 = 新建 `games/<name>/` + 大厅加卡片 + `sw.js` PRECACHE 补条目 + (小程序)新页面注册进 `app.json`。

### PWA 缓存

改了任何被预缓存的文件后,**必须把 `sw.js` 的 `CACHE_VERSION` 升一位**,否则客户端永远拿旧缓存。PRECACHE 清单手动维护(当前 16 项:根 7 + schulte 4 + tetris 5)。SW 仅在 https/localhost 注册(`file://` 打开时跳过)。

### 存储(两平台同名键)

Web 用 localStorage、小程序用 wx storage,键名一致:`tetris.records`(≤50 条,含 `end: 'over'|'quit'` 标记结束方式)、`tetris.best`、`tetris.settings`(含 startLevel);`arcade.settings.theme` 为合集级主题(schulte 的老偏好会迁移过来)。两平台存储互相独立。

### 主题方案

Web:CSS 变量三段(`:root` / `[data-theme=dark]` / `@media prefers-color-scheme` + `html[data-theme=auto]`),`localStorage` 记忆,`🌑` 按钮循环切换。小程序:`darkClass` 页面类 + `wx.onThemeChange`,设置存 `arcade.settings`。新增页面/组件需两套都覆盖。

### 小程序渲染

canvas `type="2d"`:`SelectorQuery` 取 node+size、`wx.getWindowInfo().pixelRatio` 设物理尺寸、`canvas.requestAnimationFrame` 驱动。触控按钮用 `bindtouchstart/end/cancel` + `data-act`,长按重复(DAS/ARR/SOFT_ARR)与 Web 版常量一致。浮层用 `catchtouchmove="noop"` 防滚动穿透(页面需有 `noop(){}` 方法)。

## 安全红线

真实 appid 只存在于 `project.private.config.json`(已 gitignore,不要把其中的值写进任何入库文件或提交信息);`project.config.json` 里保持 `touristappid` 占位。**任何提交中不得出现真实 appid,AppSecret 绝不入库。**

## Git 与部署

- push 到 `origin`(github.com/bilibilixxm/game-arcade);中国网络下直连常超时,先直连,失败则 `HTTPS_PROXY=http://127.0.0.1:7892 git push`
- Pages 为 main 分支自动构建,推送后约 1-2 分钟生效;验证方式:curl 线上 `sw.js` 的 `CACHE_VERSION` 与文件字节数
- 旧仓库 `schulte-grid`(旧舒尔特部署)保留不动,是否删除由用户决定
