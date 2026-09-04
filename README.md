# 舒尔特方块

纯前端舒尔特方块(Schulte Grid)注意力训练游戏。零依赖、零构建,也可双击 `index.html` 直接游玩。

**在线使用**:https://bilibilixxm.github.io/schulte-grid/

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

- 三文件结构 `index.html + style.css + app.js`,PWA 由 `manifest.json + sw.js` 提供
- 图标由 `tools/gen-icons.js` 纯 Node 生成(零依赖):`node tools/gen-icons.js`
- **修改代码后需将 `sw.js` 中的 `CACHE_VERSION` 升一位(如 v1 → v2)**,客户端才能更新缓存
