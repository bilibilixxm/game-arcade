# Game Arcade · 游戏合集

纯前端小游戏合集,零依赖、零构建。包含:**舒尔特方块**(注意力训练)、**俄罗斯方块**(现代标准版)。打开根目录 `index.html` 进入游戏大厅,同时提供**微信小程序版**(`miniprogram/`)。

**网页在线使用**:https://bilibilixxm.github.io/game-arcade/

> 新增游戏 = 新建 `games/<名称>/` 子目录(独立三/四文件)+ 大厅加一张卡片 + `sw.js` 预缓存补条目。

## iPhone 安装(添加到主屏幕)

1. 用 iPhone 的 **Safari** 打开上面的网址
2. 点击底部工具栏的 **分享** 按钮(□↑)
3. 选择 **「添加到主屏幕」** → 确认添加
4. 从主屏幕图标打开即为全屏 App 体验,支持**离线使用**,成绩保存在手机本地

## 游戏

### 舒尔特方块(`games/schulte/`)

- 选择模式(2×2 ~ 8×8),按 **1 → N** 的顺序依次点击方块
- 点击数字 **1** 时开始计时,点完所有数字即完成
- 点错会有红色提示且不推进进度;用时/错误次数自动保存
- 每个模式分别记录历史最快成绩及达成时间;右上角 📊 查看全部记录
- 支持「下一个数字」提示开关(可在设置中关闭增加难度)

### 俄罗斯方块(`games/tetris/`)

现代标准规则:

- **7-bag 随机**出块、**幽灵投影**(落点预览)、**Hold 暂存**(每块一次)、**Next 预览**三块
- **SRS 旋转系统**含墙踢;软降(1 分/格)、硬降(2 分/格)
- 消行计分:1/2/3/4 行 = 100/300/500/800 × 等级;每 10 行升一级,下落加速
- 键盘:`←` `→` 移动 · `↑`/`X` 顺旋 · `Z` 逆旋 · `↓` 软降 · `空格` 硬降 · `C`/`Shift` 暂存 · `P` 暂停
- 手机自动显示触控按钮(长按左右/软降连续生效);切后台自动暂停
- 右上角 📊 查看最近 50 局与历史最高分

两个游戏均支持**浅色/深色/跟随系统**三种主题(右上角 🌓 切换,合集内记忆)。

## 技术说明

- 网页版:每个游戏独立三/四文件(`index.html + *.css + *.js`),俄罗斯方块逻辑抽为 `games/tetris/engine.js`(UMD,不碰 DOM)
- PWA:`manifest.json + sw.js` 提供;**改网页代码后需将 `sw.js` 中 `CACHE_VERSION` 升一位**(如 v3 → v4),客户端才能更新缓存
- 小程序版:`miniprogram/` 目录,`pages/home` 为大厅;俄罗斯方块直接 `require('libs/tetris-engine.js')` 复用同一算法(**该文件是 Web 侧 engine.js 的拷贝,改动后需同步**)
- 引擎单测:`node tools/tetris-engine.test.js`(33 项:7-bag 分布、SRS 踢墙、计分、Hold、锁定延迟、游戏结束判定)
- 资产均由 `tools/` 下脚本纯 Node 生成(零依赖):`node tools/gen-icons.js`、`node tools/gen-sounds.js`

## 微信小程序版使用

### 1. 导入开发者工具

1. 下载安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)(稳定版)
2. 打开工具 → 导入项目 → 选择**本仓库根目录**
3. AppID 选择「**测试号**」即可在模拟器中试玩全部功能

### 2. 注册小程序账号(免费,真机预览必需)

1. 打开 [mp.weixin.qq.com](https://mp.weixin.qq.com/) → 立即注册 → 选「小程序」
2. 个人主体即可:邮箱激活 → 主体类型选「个人」→ 身份证 + 微信扫码验证
3. 注册完成后,登录 → 设置 → 基本设置 → 开发者 → AppID,复制下来
4. 填入 `project.private.config.json` 的 `"appid"` 字段(该文件已 gitignore,**真实 appid 不入库**;`project.config.json` 中保持 `touristappid` 占位)

### 3. 真机预览与日常使用

- 开发者工具点「**预览**」→ 手机微信扫码,即可真机试玩
- 日常自用:点「**上传**」→ 到 mp.weixin.qq.com 后台「版本管理」将上传版本设为**体验版** → 体验成员扫码长期使用
- 公开发布(任何人可搜到):后台提交**审核**,通过后发布上线

### 4. 目录结构

```
project.config.json            # 开发者工具项目配置(appid 为占位)
project.private.config.json    # 私有配置(真实 appid;已 gitignore)
miniprogram/
├── app.json / app.js / app.wxss
├── theme.json                 # 深色模式导航栏/窗口配色
├── sitemap.json
├── libs/tetris-engine.js      # 俄罗斯方块引擎(Web 侧副本)
├── assets/sounds/
│   ├── schulte/*.wav          # 音效(tools/gen-sounds.js 生成)
│   └── tetris/*.wav
└── pages/
    ├── home/                  # 游戏大厅(入口页)
    ├── schulte/               # 舒尔特方块
    └── tetris/                # 俄罗斯方块
```
