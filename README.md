# dsh-video-bg
（什么鲸鱼娘桌宠之类的真的弱爆了。。。就干扰工作而言，我的插件是压倒性的）
把本地视频作为 DSH 对话界面背景循环播放的插件，带播放/暂停与外观控制。
兼容 DSH 一般 web 界面（`dsh web`）与 DSH Desktop——两者渲染的是同一个 web app，
插件以相同方式注入。

## 功能

- 背景视频：固定全屏 `<video>`（`z-index: -1`）循环播放，`object-fit: cover` 填满窗口；
- 暂停/播放：右下角浮动控制条上的 ⏸/▶ 按钮；
- 不透明度滑块（10–100%）：控制视频本身的透明度；
- 遮罩滑块（0–70%）：在视频与界面之间加暗色遮罩，提升文字可读性；
- 状态持久化：暂停状态、两个滑块值存 `localStorage`（键 `dsh.videoBg.v1`）；
- 界面半透明化：通过重映射 dsh 设计 token（`--dsw-alias-bg-base`、
  `--dsw-specific-sidebar-fill`、`--dsw-specific-input-major` 等）为半透明色，
  让所有引用这些 token 的面板自动透出视频，气泡/输入框保持近不透明以保证可读性。

## 安装（一条命令，无需改任何配置文件）

```sh
# web 界面
dsh plugin --profile web add github:<你的GitHub用户名>/dsh-video-bg
# DSH Desktop
dsh plugin --profile desktop add github:<你的GitHub用户名>/dsh-video-bg
```

插件声明了 `dsh.bundle.patch`，`add` 后会自动进入 profile 的 bundle 层并挂载，
**不需要**手工往 `cordis.patch.yml` 里加行。打包版（DSH Desktop）的配置 watcher
不生效，**装完后需完全退出并重启 DSH Desktop**；`dsh web` 独立启动的界面同样生效。

## 默认视频与自定义视频

视频**不上传**：字节始终留在本机，宿主进程通过 `/video-bg/media` 路由流式转发给
浏览器（支持 HTTP Range，可拖动进度条/无缝 seek）。

默认视频路径解析顺序：

1. 插件配置 `videoPath`（见下）；
2. 环境变量 `DSH_VIDEO_BG_PATH`；
3. 包内自带 `media/background.mp4`（随插件一起分发；文件缺失时优雅降级，控制条显示 ⚠ 提示）。

**换成自己的视频**（二选一）：

- 在 profile 的 `cordis.patch.yml` 里加一个配置覆盖（无需动插件）：
  ```yaml
  - id: ui-video-bg
    config:
      videoPath: 'D:\你的视频.mp4'
  ```
- 或者设置环境变量 `DSH_VIDEO_BG_PATH` 指向你的视频。

**内置默认视频**：仓库自带 `media/background.mp4`（1080p30、约 34MB，由 4K 原片压制；
背景本来就静音、被遮罩覆盖，画质差异不可见），装完开箱即用。

**想替换默认视频**：把压缩过的小视频（建议 < 50MB）命名 `background.mp4` 覆盖
`media/` 下的文件再发布。注意 GitHub 单文件上限 100MB，不要提交几百 MB 的原片；
用 HandBrake / ffmpeg 压到 1080p、CRF 26 左右即可。

## 界面半透明原理（为什么是 token 重映射）

v0.1 用「列外壳选择器透明化」（`[data-pane=…]`、`[data-dsh-frame]`）来露出视频，
但该 UI 真正不透明的表面在列内部、使用哈希 css-module 类名的组件上
（如对话区根部 `.wSkVaW_root` 直接 `background: var(--dsw-alias-bg-base)`），
v0.1 的 CSS 覆盖不到它们，视频被整个盖住。

v0.2 起采用官方皮肤系统（blue-fantasy/whale-song）验证过的配方：
给 `<body>` 打 `data-dsh-video-bg` 属性，把 dsh 设计 token 直接重映射为半透明色
（含 `data-ds-dark-theme` 暗色变体），任何引用 token 的表面都会自动变透。
视频层保持在 `z-index: -1`，透出后即为对话背景。

## 目录结构

```
dsh-video-bg/
  package.json         # dsh.bundle.patch + dsh.client 声明（双面插件，bundle 层）
  cordis.patch.yml     # bundle patch：把插件行插入 profile roster
  lib/index.js         # 宿主侧：/video-bg/media（Range 流式）+ /video-bg/status
  lib/client.js        # 浏览器侧：视频背景 + 控制条 + 半透明 CSS
  media/background.mp4 # 内置默认背景视频（1080p30，~34MB，可替换）
```

## 卸载

```sh
dsh plugin --profile desktop remove @local/dsh-video-bg
dsh plugin --profile web remove @local/dsh-video-bg
```

## 限制

- 视频始终静音（浏览器自动播放策略 + 背景视频通常不应出声）。
- 视频文件在宿主机上读取；改路径后需重启宿主进程或重载插件配置。
- 已启用其它皮肤时，皮肤的不透明表面可能盖住视频（皮肤优先）。
- 仓库内置默认背景视频（`media/background.mp4`）；替换它或配置 `videoPath` 即可换成自己的视频。
