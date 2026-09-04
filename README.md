# 舒尔特方块

纯前端舒尔特方块(Schulte Grid)注意力训练游戏。零依赖、零构建,双击 `index.html` 直接游玩,同时提供**微信小程序版**(`miniprogram/`)。

**网页在线使用**:https://bilibilixxm.github.io/schulte-grid/

## iPhone 安装(添加到主屏幕)

1. 用 iPhone 的 **Safari** 打开上面的网址
2. 点击底部工具栏的 **分享** 按钮(□↑)
3. 选择 **「添加到主屏幕」** → 确认添加
4. 从主屏幕图标打开即为全屏 App 体验,支持**离线使用**,训练成绩保存在手机本地

## 玩法

- 选择模式(2×2 ~ 8×8),按 **1 → N** 的顺序依次点击方块
- 点击数字 **1** 时开始计时,点完所有数字即完成
- 点错会有红色提示且不推进进度;成绩(用时/错误次数)自动保存
- 每个模式分别记录历史最快成绩及达成时间;右上角 📊 查看全部记录

## 技术说明

- 网页版:三文件结构 `index.html + style.css + app.js`,PWA 由 `manifest.json + sw.js` 提供
- 小程序版:`miniprogram/` 目录,与网页版功能一致(七种模式、计时、成绩记录、深色模式、音效、历史抽屉),音效为 `tools/gen-sounds.js` 生成的 WAV 文件
- 资产均由 `tools/` 下脚本纯 Node 生成(零依赖):`node tools/gen-icons.js`、`node tools/gen-sounds.js`
- **网页版改代码后需将 `sw.js` 中的 `CACHE_VERSION` 升一位(如 v1 → v2)**,客户端才能更新缓存

## 微信小程序版使用

### 1. 导入开发者工具

1. 下载安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)(稳定版)
2. 打开工具 → 导入项目 → 选择**本仓库根目录**
3. AppID 选择「**测试号**」即可在模拟器中试玩全部功能

### 2. 注册小程序账号(免费,真机预览必需)

1. 打开 [mp.weixin.qq.com](https://mp.weixin.qq.com/) → 立即注册 → 选「小程序」
2. 个人主体即可:邮箱激活 → 主体类型选「个人」→ 身份证 + 微信扫码验证
3. 注册完成后,登录 → 设置 → 基本设置 → 开发者 → AppID,复制下来
4. 填入本仓库 `project.config.json` 的 `"appid"` 字段(替换 `touristappid`)

### 3. 真机预览与日常使用

- 开发者工具点「**预览**」→ 手机微信扫码,即可真机试玩
- 日常自用:点「**上传**」→ 到 mp.weixin.qq.com 后台「版本管理」将上传版本设为**体验版** → 体验成员扫码长期使用
- 公开发布(任何人可搜到):后台提交**审核**,通过后发布上线

### 4. 目录结构

```
project.config.json          # 开发者工具项目配置(appid 在这里改)
miniprogram/
├── app.json / app.js / app.wxss
├── theme.json               # 深色模式导航栏/窗口配色
├── sitemap.json
├── assets/sounds/*.wav      # 音效(tools/gen-sounds.js 生成)
└── pages/index/             # 游戏页面(wxml/wxss/js/json)
```
