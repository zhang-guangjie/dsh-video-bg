/**
 * dsh-video-bg — browser half (served at /plugins/@local/dsh-video-bg/client.js).
 *
 * Boot contract (same as every client plugin): the bundle registers a factory
 * via `window.__ModuleLoader__.load`, and the kernel calls the exported
 * `apply(ctx)`; `ctx.effect(cb)` runs the callback immediately and treats its
 * return value as the disposer.
 *
 * Why a token remap instead of per-selector transparency (v0.2):
 *   The DSH web shell paints its panels through design tokens — the frame and
 *   the conversation/detail roots all use `var(--dsw-alias-bg-base)`, the
 *   sidebar uses `var(--dsw-specific-sidebar-fill)`, the composer card uses
 *   `var(--dsw-specific-input-major)`. The v0.1 CSS tried to neutralize each
 *   surface by class/attribute selectors, but the actual opaque surfaces live
 *   inside the columns on hashed css-module classes (e.g. `.wSkVaW_root`,
 *   `.ydkMvW_root`), so the video stayed covered. The skin system (blue-fantasy
 *   / whale-song) solves this by remapping the tokens themselves to
 *   semi-transparent colors scoped under a body attribute — every surface that
 *   references the token becomes translucent automatically. This plugin now
 *   mirrors that proven recipe: `body[data-dsh-video-bg]` redefines the tokens
 *   (light + `data-ds-dark-theme` variants), and a fixed `z-index: -1` <video>
 *   streams the local file from /video-bg/media behind the translucent shell.
 *
 * What it does:
 *  - scopes a translucent token remap on `<body data-dsh-video-bg>`;
 *  - injects a fixed full-viewport <video> (muted, looped, autoplay) streaming
 *    /video-bg/media — no upload, bytes stay on this machine;
 *  - injects CSS that makes the app surfaces translucent so the video shows
 *    through behind the chat (bubbles / composer keep near-opaque surfaces for
 *    readability);
 *  - adds a floating bottom-right control: play/pause toggle + opacity + veil
 *    sliders, persisted in localStorage (dsh.videoBg.v1).
 */
window.__ModuleLoader__.load({
	id: "@local/dsh-video-bg",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const MEDIA_URL = "/video-bg/media";
		const STATUS_URL = "/video-bg/status";
		const STORAGE_KEY = "dsh.videoBg.v1";
		const CSS_TAG_ID = "@local/dsh-video-bg/styles";
		const BODY_ATTR = "data-dsh-video-bg";

		function clamp(value, min, max, fallback) {
			const n = Number(value);
			if (!Number.isFinite(n)) return fallback;
			return Math.max(min, Math.min(max, n));
		}

		function readState() {
			const fallback = { paused: false, opacity: 55, veil: 25, open: true };
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (!raw) return fallback;
				const parsed = JSON.parse(raw);
				return {
					paused: parsed.paused === true,
					opacity: clamp(parsed.opacity, 10, 100, fallback.opacity),
					veil: clamp(parsed.veil, 0, 70, fallback.veil),
					open: parsed.open !== false
				};
			} catch {
				return fallback;
			}
		}

		function saveState(state) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch {
				/* storage unavailable — state just won't persist */
			}
		}

		/**
		 * The stylesheet. Everything is scoped under `body[data-dsh-video-bg]`
		 * (the attribute is set in apply()) so removal is a single attribute
		 * delete — mirrors how the dsh skin system scopes itself.
		 */
		function buildStyle() {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-video-bg";
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = `
/* --- dsh-video-bg: translucent token remap (light theme) --- */
body[data-dsh-video-bg] {
  --dsw-alias-bg-base: rgba(255, 255, 255, 0.40);
  --dsw-alias-bg-layer-1: rgba(248, 250, 253, 0.44);
  --dsw-alias-bg-layer-2: rgba(241, 244, 250, 0.50);
  --dsw-alias-bg-layer-3: rgba(233, 237, 247, 0.55);
  --dsw-alias-bg-module-platform: rgba(241, 244, 250, 0.52);
  --dsw-alias-bg-float: rgba(255, 255, 255, 0.52);
  --dsw-specific-sidebar-fill: rgba(246, 248, 253, 0.42);
  --dsw-specific-input-major: rgba(255, 255, 255, 0.58);
  --dsw-specific-menu: rgba(250, 251, 254, 0.95);
  --dsw-specific-tip: rgba(247, 249, 253, 0.62);
  --dsw-specific-bubble: rgba(255, 255, 255, 0.92);
}
/* --- dsh-video-bg: translucent token remap (dark theme) --- */
body[data-dsh-video-bg][data-ds-dark-theme] {
  --dsw-alias-bg-base: rgba(10, 14, 21, 0.40);
  --dsw-alias-bg-layer-1: rgba(15, 20, 29, 0.44);
  --dsw-alias-bg-layer-2: rgba(20, 26, 36, 0.50);
  --dsw-alias-bg-layer-3: rgba(26, 33, 44, 0.55);
  --dsw-alias-bg-module-platform: rgba(22, 28, 38, 0.52);
  --dsw-alias-bg-float: rgba(16, 21, 30, 0.52);
  --dsw-specific-sidebar-fill: rgba(11, 15, 22, 0.42);
  --dsw-specific-input-major: rgba(16, 22, 31, 0.58);
  --dsw-specific-menu: rgba(13, 18, 26, 0.95);
  --dsw-specific-tip: rgba(15, 20, 29, 0.62);
  --dsw-specific-bubble: rgba(32, 39, 53, 0.92);
}
/* --- dsh-video-bg: canvas & shell transparent (video sits at z-index -1) --- */
html {
  background: #0a0e14 !important;
}
body,
#root {
  background: transparent !important;
}
[data-dsh-frame] {
  background: transparent !important;
}
/* --- dsh-video-bg: background layer --- */
#dsh-video-bg-media,
#dsh-video-bg-scrim {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: -1;
}
#dsh-video-bg-media {
  object-fit: cover;
  background: #000;
}
#dsh-video-bg-scrim {
  background: rgba(6, 10, 16, 0.25);
}
/* --- dsh-video-bg: floating control --- */
#dsh-video-bg-control {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 2147483001;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 176px;
  padding: 6px 8px;
  border-radius: 12px;
  background: rgba(12, 16, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e8ecf4;
  font: 12px/1.4 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  user-select: none;
}
#dsh-video-bg-top {
  display: flex;
  align-items: center;
  gap: 4px;
}
#dsh-video-bg-toggle {
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  width: 30px;
  height: 28px;
  border-radius: 8px;
}
#dsh-video-bg-toggle:hover {
  background: rgba(255, 255, 255, 0.14);
}
#dsh-video-bg-toggle.error {
  color: #ffb74d;
}
#dsh-video-bg-more {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: #c6cede;
  font-size: 12px;
  cursor: pointer;
  width: 24px;
  height: 28px;
  border-radius: 8px;
}
#dsh-video-bg-more:hover {
  background: rgba(255, 255, 255, 0.12);
}
#dsh-video-bg-waiting {
  flex: 1;
  min-width: 0;
  text-align: center;
  color: #ffb74d;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#dsh-video-bg-waiting:empty {
  display: none;
}
#dsh-video-bg-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 2px 2px;
}
#dsh-video-bg-control:not([data-open]) #dsh-video-bg-panel {
  display: none;
}
#dsh-video-bg-panel .row {
  display: flex;
  align-items: center;
  gap: 6px;
}
#dsh-video-bg-panel .row span {
  width: 46px;
  color: #b9c2d0;
}
#dsh-video-bg-panel input[type="range"] {
  flex: 1;
  min-width: 56px;
  accent-color: #4d7cfe;
}
#dsh-video-bg-panel .row b {
  width: 34px;
  text-align: right;
  font-weight: 600;
  color: #e8ecf4;
}
`;
			return tag;
		}

		/**
		 * Mount the video background. Idempotent per page: the effect disposer
		 * removes everything (body attribute + elements + style tag) when the
		 * fiber unloads.
		 */
		function apply(ctx) {
			if (typeof document === "undefined" || typeof window === "undefined") return;
			if (!document.body) return;

			ctx.effect(() => {
				/* Idempotency guard: if a previous fiber already mounted the
				 * background (double apply / hot re-apply), leave it alone so the
				 * video never gets torn down and re-created (which would make it
				 * restart from 0 — a "plays, stalls, replays" look-alike). */
				if (document.getElementById("dsh-video-bg-media")) {
					return () => {};
				}

				const state = readState();

				/* 1. body attribute scopes the translucent token remap */
				document.body.setAttribute(BODY_ATTR, "");

				/* 2. style */
				const style = buildStyle();
				document.head.appendChild(style);

				/* 3. video layer */
				const video = document.createElement("video");
				video.id = "dsh-video-bg-media";
				video.muted = true;
				video.defaultMuted = true;
				video.loop = true;
				video.autoplay = true;
				video.preload = "auto";
				video.playsInline = true;
				video.setAttribute("playsinline", "");
				video.setAttribute("muted", "");
				video.setAttribute("aria-hidden", "true");
				video.style.opacity = String(state.opacity / 100);
				video.src = MEDIA_URL;

				/* 4. veil scrim */
				const scrim = document.createElement("div");
				scrim.id = "dsh-video-bg-scrim";
				scrim.setAttribute("aria-hidden", "true");
				scrim.style.background = `rgba(6, 10, 16, ${state.veil / 100})`;

				/* 5. floating control */
				const control = document.createElement("div");
				control.id = "dsh-video-bg-control";
				if (state.open) control.dataset.open = "";
				control.innerHTML = `
					<div id="dsh-video-bg-top">
						<button id="dsh-video-bg-toggle" type="button" title="播放 / 暂停背景视频">⏸</button>
						<span id="dsh-video-bg-waiting"></span>
						<button id="dsh-video-bg-more" type="button" title="展开 / 收起设置">${state.open ? "▴" : "▾"}</button>
					</div>
					<div id="dsh-video-bg-panel">
						<div class="row"><span>不透明度</span><input id="dsh-video-bg-opacity" type="range" min="10" max="100" step="5" value="${state.opacity}"><b id="dsh-video-bg-opacity-v">${state.opacity}%</b></div>
						<div class="row"><span>遮罩</span><input id="dsh-video-bg-veil" type="range" min="0" max="70" step="5" value="${state.veil}"><b id="dsh-video-bg-veil-v">${state.veil}%</b></div>
					</div>`;

				document.body.appendChild(video);
				document.body.appendChild(scrim);
				document.body.appendChild(control);

				const toggle = control.querySelector("#dsh-video-bg-toggle");
				const more = control.querySelector("#dsh-video-bg-more");
				const opacityInput = control.querySelector("#dsh-video-bg-opacity");
				const opacityValue = control.querySelector("#dsh-video-bg-opacity-v");
				const veilInput = control.querySelector("#dsh-video-bg-veil");
				const veilValue = control.querySelector("#dsh-video-bg-veil-v");

				const syncIcon = () => {
					if (video.paused) {
						toggle.textContent = "▶";
						toggle.title = "播放背景视频";
					} else {
						toggle.textContent = "⏸";
						toggle.title = "暂停背景视频";
					}
				};

				const togglePlay = () => {
					if (video.paused) {
						video.play().catch(() => {
							toggle.classList.add("error");
						});
					} else {
						video.pause();
					}
				};

				toggle.addEventListener("click", togglePlay);
				more.addEventListener("click", () => {
					const open = control.hasAttribute("data-open");
					if (open) {
						control.removeAttribute("data-open");
						more.textContent = "▾";
						more.title = "展开设置";
					} else {
						control.dataset.open = "";
						more.textContent = "▴";
						more.title = "收起设置";
					}
					state.open = !open;
					saveState(state);
				});
				opacityInput.addEventListener("input", () => {
					const v = clamp(opacityInput.value, 10, 100, 55);
					video.style.opacity = String(v / 100);
					opacityValue.textContent = `${v}%`;
					state.opacity = v;
					saveState(state);
				});
				veilInput.addEventListener("input", () => {
					const v = clamp(veilInput.value, 0, 70, 25);
					scrim.style.background = `rgba(6, 10, 16, ${v / 100})`;
					veilValue.textContent = `${v}%`;
					state.veil = v;
					saveState(state);
				});
				video.addEventListener("play", syncIcon);
				video.addEventListener("pause", syncIcon);
				syncIcon();
				video.addEventListener("error", () => {
					toggle.classList.add("error");
					toggle.textContent = "⚠";
					toggle.title = "背景视频加载失败（默认 media/background.mp4 缺失或 videoPath 配置错误）";
					console.warn("dsh-video-bg: video element error", video.error);
				});

				const waiting = control.querySelector("#dsh-video-bg-waiting");
				const showWaiting = () => {
					waiting.textContent = "缓冲中…";
				};
				const hideWaiting = () => {
					waiting.textContent = "";
				};
				video.addEventListener("waiting", showWaiting);
				video.addEventListener("playing", hideWaiting);
				video.addEventListener("canplay", hideWaiting);

				if (state.paused) {
					/* Autoplay is set, so pause explicitly once metadata is ready. */
					const hold = () => {
						video.pause();
						video.removeEventListener("loadedmetadata", hold);
					};
					video.addEventListener("loadedmetadata", hold);
				}

				/* Status badge: show the served path in the tooltip when reachable. */
				fetch(`${STATUS_URL}?t=${Date.now()}`)
					.then((res) => res.ok ? res.json() : null)
					.then((data) => {
						if (data && data.ok) {
							toggle.title = `播放 / 暂停背景视频（${data.path}）`;
						}
					})
					.catch(() => {
						/* host route not reachable — keep the default title */
					});

				return () => {
					document.body.removeAttribute(BODY_ATTR);
					video.pause();
					video.removeAttribute("src");
					try {
						video.load();
					} catch {
						/* no-op */
					}
					video.remove();
					scrim.remove();
					control.remove();
					style.remove();
				};
			}, "dsh-video-bg: video background");
		}

		exports.apply = apply;
		return module.exports;
	}
});
