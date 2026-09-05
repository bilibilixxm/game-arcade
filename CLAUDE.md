# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库概览

纯前端小游戏合集(Game Arcade),零依赖、零构建,同时提供微信小程序版。网页版部署在 GitHub Pages:https://bilibilixxm.github.io/game-arcade/(main 分支 legacy 构建)。

## 常用命令

```bash
# 引擎单测(纯 Node,无测试框架,直接跑)
node tools/tetris-engine.test.js      # 39 项断言
node tools/battle-city-engine.test.js # 65 项断言
node tools/flappy-engine.test.js      # 43 项断言

# 重新生成资产(纯 Node 零依赖)
node tools/gen-icons.js     # icons/icon-{180,192,512}.png(马赛克手柄像素画)
node tools/gen-sounds.js    # miniprogram/assets/sounds/{schulte,tetris,battle-city,flappy}/*.wav

# 本地服务器(PWA/SW 测试需要 http;8123 被本机 Home Assistant 占用,用 8917)
python3 -m http.server 8917
```

**Playwright UI 测试**(schulte 35 项 / lobby 7 项 / tetris 36 项 / battle-city 47 项 / flappy 38 项 / PWA 18 项)不进仓库,放在 `/tmp/schulte-test/`(test.js、lobby-test.js、tetris-test.js、battle-city-test.js、flappy-test.js、pwa-test.js),用 `playwright-core` 指向本机 chrome-headless-shell:

若 `/tmp/schulte-test/` 已被清理,需按上述断言数量重写测试脚本(它们覆盖:PWA 预缓存计数、离线可玩、iOS 安装提示三态、tetris 键盘+触控流、canvas 渲染位置像素断言、大厅与子页 localStorage 联动、flappy 白盒挪管计分/奖牌/结算浮层)。

小程序无自动化测试;提交前做静态校验:所有 JSON 可解析、`node --check` 每个 JS、WXML 里的 bind 方法与 data 字段和 JS 交叉核对(历史会话用临时 node 脚本完成,现存 `/tmp/schulte-test/battle-city-static.js`、`flappy-static.js`;另有 Node 仿真 harness `/tmp/schulte-test/battle-city-mp-harness.js`、`flappy-mp-harness.js` 驱动页面全流程)。

## 架构

### 双平台共用引擎(最重要的约定)

`games/tetris/engine.js` 是**规范源**:UMD 纯逻辑引擎(7-bag、SRS 踢墙、Hold、锁定延迟、计分),不碰 DOM/wx。`miniprogram/libs/tetris-engine.js` 是它的**手动同步副本**。改引擎必须:①同步副本(diff 两文件从 `(function (root, factory)` 起应完全一致);②跑 `node tools/tetris-engine.test.js`。

battle-city 有**三个**规范源文件与副本:`games/battle-city/{engine,levels,sprites}.js` ↔ `miniprogram/libs/battle-city-{engine,levels,sprites}.js`(副本头部是自定义注释,从 UMD 标记行起逐字节一致),单测 `node tools/battle-city-engine.test.js`。

引擎注意点:
- `pieceCells()` 返回**绝对坐标**(曾因 UI 层把它当相对坐标再叠加 `current.y` 导致方块画偏,两平台同踩)
- `lastDrop = -1` 哨兵(falsy 0 问题);`reset({level})` 支持起始难度,升级取 `max(startLevel, floor(lines/10)+1)`
- 引擎无回调;UI 层用 watch 模式判定锁定/消行/升级:动作前 `beginWatch()` 记录 `current` 引用与 lines/level,动作后 `endWatch()` 对比(hold 走 `endWatch(false)` 不出锁定音)

battle-city 注意点:
- 地形存**字母码** `'B'/'S'/'W'/'T'/'I'/'F'`(8px 子格 26×26),渲染层需 `TILE_KEYS` 映射到精灵表键,且**必须跳过 'F'**(基地,不在 TILES 里——曾因漏跳导致页面启动即崩)
- 精灵只存上向基准图,`rotateCW` 旋转出 4 方向;armor 变色/bonus 闪红全部用**调色板替换**(零额外图);平台侧把 grid+palette 物化为离屏 canvas 并缓存,每帧只 drawImage
- 静态地形预渲染两层离屏(普通层 + 树置顶层),水帧翻转(400ms)时才重建;**杜绝逐像素 fillRect 进主循环**(小程序性能关键)
- 1P 出生点 (64,192) 右侧紧贴基地护墙大格 (5,12),开局向右被挡是**原版行为**(测试勿当 bug)
- 直线移动是连续坐标,只有**转向时垂直轴才吸附 8px**;引擎 fire 是上升沿单发(`keyboard.press` 同帧 down+up 触发不了)
- `engine.RULES` 是 createBattleCity 时合并后的**活对象**:`reset()` 不会重建它,运行时改 `engine.RULES.wholeBrick`(一击整块砖)立即生效——两平台的"砖块模式"开关都靠这个实现,设置存 `battle-city.settings`(startStage/wholeBrick)
- 起始关卡走引擎现成的 `reset({ stage: N })`,过关后自然 N+1;选关 UI 钳位 1..35
- 手机触控是**摇杆**(Web pointer events + setPointerCapture;小程序 bindtouchstart/move/end,`joyRect` 由 onReady 时 `.joy` boundingClientRect 提供):死区 25% 半径、主轴取分量大者,**不抬手即可换向**(旧 dpad 已删,测试勿再找 #tc-up)
- 事件队列 `drainEvents()` 驱动音效/特效(引擎无回调)

flappy 有**两个**规范源文件与副本:`games/flappy/{engine,sprites}.js` ↔ `miniprogram/libs/flappy-{engine,sprites}.js`(副本头部是自定义注释,从 UMD 标记行起逐字节一致),单测 `node tools/flappy-engine.test.js`。

flappy 注意点:
- 状态机 ready→playing→dying→over:撞管→dying(世界停止滚动、鸟自由落体)→触地 over;playing 直接触地立即 over;**触顶只钳位不死**(原版行为);**碰撞先于计分**(同帧撞管不给分,单测曾揭示此序)
- `tick(now)` 同款 dt 制:首帧 `lastNow = -1` 哨兵不算 dt、dt 钳 50ms;**测试里 fresh() 后必须先 tick 一次烧哨兵**再断言物理,否则全错
- 管道在 x=SPAWN_X=W+30=318 生成(出屏防 pop-in),滚到间距 172 才生成下一根;缺口中心 rng ∈ [90,310];`createFlappy({ rng })` 注入随机数(仅缺口位置),单测用 mulberry32 确定性复现
- 鸟 34×24 显示、**命中盒 24×16**;`puppet` 手法:单测把 `state.bird.y` 钉在缺口内(或自适应瞬移到最近缺口)保持存活,收集管用 `Set` 收对象引用(break 条件用 score,同屏管数会变)
- UI 层职责:鸟旋转(vel<0 → -25°,下落按速度逼近 90°,dying 时 +480°/s)、地面滚动取模、撞击白闪;鸟 3 帧×3 色调色板替换 + 白字细描边大数字(4× 像素 + 2px 外扩描边)全物化为离屏,每帧只 drawImage
- 每局随机白天/黑夜背景 + 鸟色(渲染层 `Math.random`,与引擎 rng 无关);无难度设置,`flappy.settings` 仅存 sound,主题走合集级 `arcade.settings`

### 每游戏独立目录 + 三层共享件

```
games/<name>/{index.html, *.css, *.js}   # 各游戏完全独立,文件引用用相对路径(./、../../)
index.html + lobby.css                    # 大厅:读 localStorage 在卡片上显示各游戏最高分(data-best-key)
sw.js + manifest.json + icons/            # PWA 层,作用于全站
miniprogram/pages/{home,schulte,tetris,battle-city,flappy}/  # 小程序:home 大厅 → wx.navigateTo
```

新增游戏 = 新建 `games/<name>/` + 大厅加卡片 + `sw.js` PRECACHE 补条目 + (小程序)新页面注册进 `app.json`。

### PWA 缓存

改了任何被预缓存的文件后,**必须把 `sw.js` 的 `CACHE_VERSION` 升一位**,否则客户端永远拿旧缓存。PRECACHE 清单手动维护(当前 28 项:根 7 + schulte 4 + tetris 5 + battle-city 6 + flappy 6)。SW 仅在 https/localhost 注册(`file://` 打开时跳过)。

### 存储(两平台同名键)

Web 用 localStorage、小程序用 wx storage,键名一致:`tetris.records`(≤50 条,含 `end: 'over'|'quit'` 标记结束方式)、`tetris.best`、`tetris.settings`(含 startLevel);`battle-city.records`(≤50 条,含 `end` 与 `player: '1P'|'2P'`——网页双人局存两条)/`battle-city.best`/`battle-city.settings`;`flappy.records`(≤50 条,含 `end: 'over'`)/`flappy.best`/`flappy.settings`(仅 sound);`arcade.settings.theme` 为合集级主题(schulte 的老偏好会迁移过来;小程序各游戏页共用它)。两平台存储互相独立。

### 主题方案

Web:CSS 变量三段(`:root` / `[data-theme=dark]` / `@media prefers-color-scheme` + `html[data-theme=auto]`),`localStorage` 记忆,`🌑` 按钮循环切换。小程序:`darkClass` 页面类 + `wx.onThemeChange`,设置存 `arcade.settings`。新增页面/组件需两套都覆盖。

### 小程序渲染

canvas `type="2d"`:`SelectorQuery` 取 node+size、`wx.getWindowInfo().pixelRatio` 设物理尺寸、`canvas.requestAnimationFrame` 驱动。触控按钮用 `bindtouchstart/end/cancel` + `data-act`,长按重复(DAS/ARR/SOFT_ARR)与 Web 版常量一致。浮层用 `catchtouchmove="noop"` 防滚动穿透(页面需有 `noop(){}` 方法)。离屏精灵用 `wx.createOffscreenCanvas({type:'2d', width, height})`。小程序无自动化测试时可用 Node 仿真(`wx`/`Page` 全局 + Proxy 假 canvas,见 `/tmp/schulte-test/battle-city-mp-harness.js` 的做法)驱动页面全流程。

## 安全红线

真实 appid 只存在于 `project.private.config.json`(已 gitignore,不要把其中的值写进任何入库文件或提交信息);`project.config.json` 里保持 `touristappid` 占位。**任何提交中不得出现真实 appid,AppSecret 绝不入库。**

## Git 与部署

- push 到 `origin`(github.com/bilibilixxm/game-arcade);中国网络下直连常超时,先直连,失败则 `HTTPS_PROXY=http://127.0.0.1:7892 git push`
- Pages 为 main 分支自动构建,推送后约 1-2 分钟生效;验证方式:curl 线上 `sw.js` 的 `CACHE_VERSION` 与文件字节数
- 旧仓库 `schulte-grid`(旧舒尔特部署)保留不动,是否删除由用户决定
