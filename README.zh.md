# dsh-video-bg

> **真没想到你能做到这一步啊！领域展开——【无量空处】**

[English](README.md) | 中文

把本地视频作为 DeepSeek Harness 对话界面的背景循环播放——同时适配纯 Web
界面（`dsh web`）与 DSH Desktop（桌面端渲染的是同一个 Web 应用）。面板会变为
半透明以透出视频，聊天气泡与输入框保持接近不透明，保证可读性。

![背景视频与浮动控制面板](assets/screenshot-1.png)

## 功能

- **背景视频**：固定全屏 `<video>`（`z-index: -1`），由宿主进程通过 HTTP
  流式转发，几百 MB 的本地文件也无需上传；支持 HTTP Range（`206`/`416`），
  浏览器可拖动进度与预读。
- **界面半透明**：重映射外壳的设计 token（`--dsw-alias-bg-base`、
  `--dsw-specific-sidebar-fill`、`--dsw-specific-input-major` 等）为半透明色，
  亮色/暗色主题各一套，所有引用 token 的表面自动变透；气泡与输入框保持近不透明。
- **右上角浮动控制**：播放/暂停、视频不透明度、遮罩、填充方式（`cover`/`contain`）、
  收起/展开。选择持久化在 `localStorage`（`dsh.videoBg.v3`）；窗口隐藏时自动暂停。
- **失败可见**：文件缺失或不可读时显示警告标记并在控制台给出诊断，不会静默失效。
- **纯本地**：视频字节不离开本机。插件只在 DSH 已有的回环 HTTP 服务上注册两个路由，
  没有任何外部服务或遥测。

![收起控制面板后可见更多视频画面](assets/screenshot-2.png)

## 环境要求

- DeepSeek Harness **0.2.x**（`package.json` 中的 `engines.dsh`），网页端或桌面端。
  安装/启动时会按已装运行时版本校验 bundle。
- Node 20+（宿主侧只使用 `node:fs`、`node:path`、`node:url`）。
- 视频文件必须能被**宿主进程**读取（不是浏览器）。识别 MP4/WebM/MOV/MKV/AVI/OGG/TS，
  其他扩展名按 `video/mp4` 提供。

## 安装

本包是标准 DSH bundle，以下方式均可：

```sh
# 从 GitHub 安装（纯 JavaScript，无需构建，也不需要 allowBuilds 授权）
dsh plugin --profile desktop add github:zhang-guangjie/dsh-video-bg
dsh plugin --profile web add github:zhang-guangjie/dsh-video-bg

# 从本地 checkout 安装（开发时推荐）
dsh plugin --profile desktop add link:/绝对路径/dsh-video-bg

# 发布到 npm 后
dsh plugin --profile desktop add dsh-video-bg
```

也可以在图形界面的插件管理页（插件 → 安装 / 插件市场）中安装。安装 bundle 会自动
把它加入 `dsh.profile.bundles`，**不需要**手工添加插件行。

**桌面端说明**：官方桌面 profile 下新装 bundle 会即时生效（运行中的组合会重组，
页面通过客户端模块图收到新条目）；如果你的 profile 是“仅启动时应用”，装完后需
完全退出并重启 DSH Desktop 一次。

## 配置视频

视频路径解析顺序：

1. 插件行配置 `videoPath`；
2. 环境变量 `DSH_VIDEO_BG_PATH`；
3. 包内自带的 `media/background.mp4`（默认小样片）。

在你自己的 profile patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）中配置：

```yaml
- id: ui-video-bg
  config:
    videoPath: 'D:\我的视频.mp4'   # 任意本地路径，支持 ~ 展开
    fit: cover                     # cover | contain
    opacity: 55                    # 视频初始不透明度 0-100
    veil: 25                       # 初始遮罩 0-100
```

- `videoPath`、`fit` 由宿主读取；`opacity`/`veil` 只是浏览器尚无本地保存值时的初始值
  （之后以控制条里的值为准）。
- 插件行 id 为 `ui-video-bg`；HMR 开启时修改配置会热重载插件。
- 也可以用环境变量：启动 DSH 前设置 `DSH_VIDEO_BG_PATH`。

## 使用

右上角浮动控制：

| 控件 | 作用 |
|---|---|
| ▶ / ⏸ | 暂停 / 继续背景视频 |
| 不透明度 | 视频不透明度（0–100%），持久化 |
| 遮罩 | 视频与界面之间的暗色遮罩（0–100%），持久化 |
| 填充 | `铺满`（cover，填满窗口）或 `完整`（contain，显示整帧） |
| ▴ / ▾ | 收起 / 展开设置面板 |

播放按钮旁的标记会提示缓冲中与文件错误；文件缺失也会体现在
`GET /video-bg/status` 的返回和宿主日志中。

## 实现原理

- **宿主半**（`lib/index.js`，包根导出）声明 `inject = ['webServer']` 并注册前缀路由：
  - `GET/HEAD /video-bg/media`：带单区间 Range 支持地流式返回配置的文件，并用
    `?v=<size>-<mtime>` 作为缓存版本，文件变化后不会被旧媒体缓存命中。
  - `GET /video-bg/status`：JSON（`ok`、`rev`、`size`、`mime`、实际路径/来源、默认外观）。
- **浏览器半**（`lib/client.js`，导出为 `./client`）是懒加载的
  `window.__ModuleLoader__.load({ id, factory })` bundle。`apply(ctx)` 内的一切都挂在
  `ctx.effect(...)` 下，禁用插件或热替换时属性、样式、视频、遮罩、控制条会一并移除。
- **两种界面**：浏览器同源请求上述路由；DSH Desktop 的文档来自 `dsh-app://app/`，
  其余路径会被转发到同一个带认证的回环宿主，因此两种界面行为一致。客户端里的 URL
  全部是文档相对路径（`video-bg/media`），不使用绝对路径。

## 隐私与安全

- 视频由宿主进程读取，**仅**通过 DSH 本来就有的回环 Web 服务提供；不上传、不发起外部请求。
- 不读取/暴露凭据、Cookie 或环境变量。`/status` 会显示配置视频的本地路径（控制条
  悬浮提示同样会显示），与本机 GUI 自身的信息级别一致。
- `videoPath` 属于可信配置（profile patch），与其它插件行配置同等对待。

## 兼容性与市场元数据

- `dsh.bundle.patch` → `cordis.patch.yml` 插入 `ui-video-bg` 行。
- `dsh.client.platform: "web"` + `exports["./client"]` → 由客户端模块系统加载。
- `engines.dsh` 与 `peerDependencies` 把 bundle 绑定到匹配的 DSH 运行时；宿主半不
  import 任何 `@deepseek-ai/*` 包，只消费注入的 `webServer` 服务。
- 展示元数据在 `locale/en.json` / `locale/zh.json`，图标 `assets/icon.svg`，
  商店截图清单 `screenshots.json`。
- 没有构建步骤，因此 GitHub 安装不需要 `allowBuilds` 授权。

## 常见问题

| 现象 | 排查 |
|---|---|
| 显示警告标记、没有视频 | 请求 `GET /video-bg/status`，`error` 为 `missing`/`unreadable`；修正 `videoPath` |
| 视频几乎看不见 | 调高不透明度、调低遮罩，或改用更亮的视频 / `contain` |
| 被其他皮肤或插件盖住 | 硬编码不透明背景的皮肤可能盖住 token 重映射；停用该皮肤/插件 |
| 刚安装没有反应 | profile 可能是“仅启动时应用”：完全重启 DSH；Web 端刷新页面 |
| 大文件启动慢一点 | 浏览器需要先从磁盘读取首批 Range 数据，随后按需流式读取 |

## 开发

```sh
# 语法检查（纯 JavaScript，无构建）
node --check lib/index.js
node --check lib/client.js

# 装进测试 profile，并在空闲端口启动 Web 界面
dsh plugin --profile mytest add link:/绝对路径/dsh-video-bg
dsh --profile mytest --no-open --port 0
```

宿主/客户端契约见官方 DSH 的 Client 模块与 Web 服务器参考文档；本包刻意保持零运行时依赖。

## 许可证

MIT
