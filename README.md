# 电子黄历

一个本地计算、开机后静默常驻系统托盘的 Windows 电子黄历。

## 首版能力

- 托盘极简今日卡片
- 当日完整黄历详情
- 农历、干支、生肖、节气、节日、宜忌、冲煞和时辰详情
- 首次启动询问开机自启动
- 完全离线运行，每日黄历只在本地按需计算，不保存逐日黄历缓存

传统民俗信息仅供文化参考，请勿作为医疗、法律、财务或其他重要决定的依据。

## 本地数据说明

- Windows WebView2 在本次运行中仍会生成浏览器临时数据；电子黄历会在下一次首实例启动、创建 WebView 前清理上一会话的 `LocalAppData/<应用标识>/EBWebView` 目录。
- 清理只针对上述 WebView 临时目录。开机自启动提示等少量本地设置独立保留，不会随临时数据一起删除。

## 开发

```powershell
npm.cmd install
npm.cmd run test:run
npm.cmd run build
cargo check --manifest-path src-tauri/Cargo.toml
npm.cmd run tauri:dev
```

## Windows 安装包

```powershell
npm.cmd run tauri:build
```

NSIS 安装包输出在 `src-tauri/target/release/bundle/nsis/`。

## 本地数据

应用不联网、不使用数据库，也不保存每日黄历。应用数据目录只保存“是否已经询问开机自启动”等少量设置；开机自启动的实际状态以 Windows 系统为准。
