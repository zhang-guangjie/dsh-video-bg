# Changelog

## 0.3.1 (2026-08-21)

- 内置默认背景视频 `media/background.mp4`（1080p30、约 34MB，由 4K 原片压制），装完开箱即用。

## 0.3.0 (2026-08-21)

- 声明 `dsh.bundle.patch`：支持 `dsh plugin add github:…/dsh-video-bg` 一条命令安装，
  自动进入 profile bundle 层，不再需要手工 insert 行（也满足插件市场受管安装的门槛）。
- 默认视频改为包内 `media/background.mp4`（随包分发，缺失时优雅降级），
  移除硬编码的 `D:\45t5win.mp4`；解析顺序：`videoPath` 配置 → `DSH_VIDEO_BG_PATH` 环境变量 → 包内默认。
- 新增 `LICENSE`（MIT）、`CHANGELOG.md`、`.gitignore`。

## 0.2.0

- 改用 dsh 设计 token 半透明重映射（`body[data-dsh-video-bg]`），修复重启后视频被盖住不显示的问题。

## 0.1.0

- 首个可用版本：背景视频 + 右下角控制条（暂停/播放、不透明度、遮罩）。
