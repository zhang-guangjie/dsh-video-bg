/**
 * dsh-video-bg — browser half (served at `/plugins/dsh-video-bg/client.js`).
 *
 * Boot contract for a DSH client bundle: this script registers a lazy factory
 * through `window.__ModuleLoader__.load({ id, factory })`; the factory returns
 * the Cordis plugin module export `{ name, apply }`, and the kernel calls
 * `apply(ctx)` once the package is materialized. `ctx.effect(callback)` runs the
 * callback immediately and treats its returned function as the disposer, so the
 * whole background (attribute, styles, video, scrim, control) disappears when
 * the plugin is disabled or hot-replaced.
 *
 * Transparency recipe: the DSH web shell paints its panels through design
 * tokens (`--dsw-alias-bg-base`, `--dsw-specific-sidebar-fill`,
 * `--dsw-specific-input-major`, …). Scoping a remap of those tokens under
 * `body[data-dsh-video-bg]` — with a `body[data-ds-dark-theme]` variant — makes
 * every surface that references a token translucent automatically, which is how
 * the official skins work. A fixed `<video>` at `z-index: -1` then shows through
 * behind the translucent shell.
 *
 * Everything is document-relative (`video-bg/media`), so the same bundle works
 * at `http://127.0.0.1:<port>/` in a browser and at `dsh-app://app/` inside DSH
 * Desktop, where non-document paths are forwarded to the authenticated host.
 */

window.__ModuleLoader__.load({
	id: "dsh-video-bg",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** Client bundle id; also the loader row id and package name. */
		const PKG_ID = "dsh-video-bg";
		const MEDIA_URL = "video-bg/media";
		const STATUS_URL = "video-bg/status";
		const STORAGE_KEY = "dsh.videoBg.v3";
		const BODY_ATTR = "data-dsh-video-bg";
		const VIDEO_ID = "dsh-video-bg-media";
		const SCRIM_ID = "dsh-video-bg-scrim";
		const CONTROL_ID = "dsh-video-bg-control";
		const STYLE_ID = "dsh-video-bg-style";
		const STATUS_TIMEOUT_MS = 1500;

		const DEFAULT_STATE = Object.freeze({
			paused: false,
			opacity: 55,
			veil: 25,
			fit: "cover",
			open: true
		});

		const ZH = {
			group: "背景视频控制",
			pause: "暂停背景视频",
			play: "播放背景视频",
			collapse: "收起设置",
			expand: "展开设置",
			opacity: "不透明度",
			veil: "遮罩",
			fit: "填充",
			cover: "铺满",
			contain: "完整",
			waiting: "缓冲中…",
			loadFailed: "视频加载失败，请检查文件或 videoPath 配置",
			missing: "视频文件不存在，请配置 videoPath",
			unreadable: "视频文件不可读，请检查路径与权限",
			autoplayBlocked: "点击播放背景视频"
		};

		const EN = {
			group: "Background video controls",
			pause: "Pause background video",
			play: "Play background video",
			collapse: "Collapse settings",
			expand: "Expand settings",
			opacity: "Opacity",
			veil: "Scrim",
			fit: "Fit",
			cover: "Cover",
			contain: "Contain",
			waiting: "Buffering…",
			loadFailed: "Background video failed to load; check the file or videoPath",
			missing: "Background video file not found; configure videoPath",
			unreadable: "Background video file is unreadable; check the path and permissions",
			autoplayBlocked: "Click to play the background video"
		};

		function clamp(value, min, max, fallback) {
			const number = Number(value);
			if (!Number.isFinite(number)) return fallback;
			return Math.min(max, Math.max(min, Math.round(number)));
		}

		function pickLocale() {
			const languages = typeof navigator === "object" && navigator !== null ? navigator.languages ?? [navigator.language] : [];
			for (const language of languages) if (typeof language === "string" && language.toLowerCase().startsWith("zh")) return ZH;
			return EN;
		}

		function readState() {
			const empty = { state: { ...DEFAULT_STATE }, stored: false };
			let raw = null;
			try {
				raw = localStorage.getItem(STORAGE_KEY);
			} catch {
				return empty;
			}
			if (raw === null) return empty;
			try {
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return empty;
				return {
					stored: true,
					state: {
						paused: parsed.paused === true,
						opacity: clamp(parsed.opacity, 0, 100, DEFAULT_STATE.opacity),
						veil: clamp(parsed.veil, 0, 100, DEFAULT_STATE.veil),
						fit: parsed.fit === "contain" ? "contain" : "cover",
						open: parsed.open !== false
					}
				};
			} catch {
				return empty;
			}
		}

		function persist(state) {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			} catch {
				/* Storage may be unavailable in a private window; state stays session-local. */
			}
		}

		/** The stylesheet for the layer, the token remap, and the floating control. */
		function buildCss() {
			return `
/* --- dsh-video-bg: translucent token remap (light theme) --- */
body[${BODY_ATTR}] {
  --dsw-alias-bg-base: rgba(255, 255, 255, 0.42);
  --dsw-alias-bg-layer-1: rgba(248, 250, 253, 0.48);
  --dsw-alias-bg-layer-2: rgba(242, 245, 250, 0.54);
  --dsw-alias-bg-overlay: rgba(255, 255, 255, 0.88);
  --dsw-specific-sidebar-fill: rgba(246, 248, 253, 0.46);
  --dsw-specific-input-major: rgba(255, 255, 255, 0.66);
  --dsw-specific-bubble: rgba(255, 255, 255, 0.92);
  --dsw-specific-tip: rgba(247, 249, 253, 0.68);
  --dsw-specific-menu: rgba(250, 251, 254, 0.96);
}
/* --- dsh-video-bg: translucent token remap (dark theme) --- */
body[${BODY_ATTR}][data-ds-dark-theme] {
  --dsw-alias-bg-base: rgba(10, 14, 21, 0.44);
  --dsw-alias-bg-layer-1: rgba(15, 20, 29, 0.50);
  --dsw-alias-bg-layer-2: rgba(20, 26, 36, 0.56);
  --dsw-alias-bg-overlay: rgba(16, 21, 30, 0.90);
  --dsw-specific-sidebar-fill: rgba(11, 15, 22, 0.46);
  --dsw-specific-input-major: rgba(16, 22, 31, 0.62);
  --dsw-specific-bubble: rgba(32, 39, 53, 0.94);
  --dsw-specific-tip: rgba(15, 20, 29, 0.68);
  --dsw-specific-menu: rgba(13, 18, 26, 0.96);
}
/* --- dsh-video-bg: canvas & shell transparency, video at z-index -1 --- */
html {
  background-color: #05070c !important;
}
body,
#root {
  background: transparent !important;
}
#${VIDEO_ID},
#${SCRIM_ID} {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: -1;
}
#${VIDEO_ID} {
  object-fit: cover;
  background: #000;
}
#${SCRIM_ID} {
  background: rgba(6, 10, 16, 0.25);
}
/* --- dsh-video-bg: floating control --- */
#${CONTROL_ID} {
  position: fixed;
  top: 64px;
  right: 20px;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 196px;
  max-width: calc(100vw - 32px);
  padding: 6px 8px;
  border-radius: 12px;
  background: rgba(12, 16, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e8ecf4;
  font: 12px/1.4 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  user-select: none;
  -webkit-user-select: none;
}
#${CONTROL_ID} .dsh-video-bg-top {
  display: flex;
  align-items: center;
  gap: 4px;
}
#${CONTROL_ID} button {
  border: 0;
  background: transparent;
  color: #fff;
  cursor: pointer;
  border-radius: 8px;
  font: inherit;
}
#${CONTROL_ID} button:hover {
  background: rgba(255, 255, 255, 0.14);
}
#${CONTROL_ID} button:focus-visible {
  outline: 2px solid #7aaaff;
  outline-offset: 1px;
}
#dsh-video-bg-toggle {
  width: 32px;
  height: 28px;
  font-size: 15px;
}
#dsh-video-bg-toggle[data-problem] {
  color: #ffb74d;
}
#dsh-video-bg-collapse {
  margin-left: auto;
  width: 24px;
  height: 28px;
  color: #c6cede;
}
#dsh-video-bg-note {
  flex: 1;
  min-width: 0;
  text-align: center;
  color: #ffb74d;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#dsh-video-bg-note:empty {
  display: none;
}
#${CONTROL_ID} .dsh-video-bg-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 2px 2px;
}
#${CONTROL_ID}:not([data-open]) .dsh-video-bg-panel {
  display: none;
}
#${CONTROL_ID} .dsh-video-bg-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
#${CONTROL_ID} .dsh-video-bg-row > span {
  width: 52px;
  flex: none;
  color: #b9c2d0;
}
#${CONTROL_ID} input[type="range"] {
  flex: 1;
  min-width: 48px;
  accent-color: #4d7cfe;
}
#${CONTROL_ID} .dsh-video-bg-row > b {
  width: 38px;
  flex: none;
  text-align: right;
  font-weight: 600;
  color: #e8ecf4;
}
#${CONTROL_ID} .dsh-video-bg-fit {
  display: flex;
  flex: 1;
  gap: 4px;
}
#${CONTROL_ID} .dsh-video-bg-fit button {
  flex: 1;
  height: 22px;
  font-size: 11px;
  color: #c6cede;
  border: 1px solid rgba(255, 255, 255, 0.16);
}
#${CONTROL_ID} .dsh-video-bg-fit button[data-active] {
  color: #fff;
  border-color: rgba(122, 170, 255, 0.75);
  background: rgba(77, 124, 254, 0.28);
}
`;
		}

		/**
		 * Mount the background. Returns a disposer; the caller keeps it for the
		 * effect teardown.
		 */
		function mount() {
			const existingVideo = document.getElementById(VIDEO_ID);
			const existingControl = document.getElementById(CONTROL_ID);
			if (existingVideo !== null && existingControl !== null) {
				/* A complete live instance already owns the background (double apply or
				 * overlapping hot replace): leave it alone so the video does not restart
				 * from zero. */
				return () => {};
			}
			/* A partial leftover (an interrupted replace, or an instance whose control
			 * was removed) is rebuilt instead of silently leaving no control at all. */
			for (const stale of document.querySelectorAll(`#${VIDEO_ID}, #${SCRIM_ID}, #${CONTROL_ID}, #${STYLE_ID}`)) {
				stale.remove();
			}

			const { state, stored } = readState();
			const t = pickLocale();
			const abort = new AbortController();
			const { signal } = abort;
			let disposed = false;
			let video = null;
			let scrim = null;
			let control = null;
			let style = null;
			let note = null;
			let toggle = null;
			let collapse = null;
			let opacityInput = null;
			let opacityValue = null;
			let veilInput = null;
			let veilValue = null;
			let hiddenPaused = false;

			document.body.setAttribute(BODY_ATTR, "");

			style = document.createElement("style");
			style.id = STYLE_ID;
			style.dataset.plugin = PKG_ID;
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = buildCss();
			document.head.appendChild(style);

			/* A hot replace can overlap teardown; keep exactly one control alive. */
			for (const stale of document.querySelectorAll(`#${CONTROL_ID}`)) stale.remove();

			control = document.createElement("div");
			control.id = CONTROL_ID;
			control.setAttribute("role", "group");
			control.setAttribute("aria-label", t.group);
			if (state.open) control.dataset.open = "";
			control.innerHTML = `
				<div class="dsh-video-bg-top">
					<button id="dsh-video-bg-toggle" type="button"></button>
					<span id="dsh-video-bg-note"></span>
					<button id="dsh-video-bg-collapse" type="button"></button>
				</div>
				<div class="dsh-video-bg-panel">
					<div class="dsh-video-bg-row"><span>${t.opacity}</span><input id="dsh-video-bg-opacity" type="range" min="0" max="100" step="5" value="${state.opacity}" aria-label="${t.opacity}"><b id="dsh-video-bg-opacity-v">${state.opacity}%</b></div>
					<div class="dsh-video-bg-row"><span>${t.veil}</span><input id="dsh-video-bg-veil" type="range" min="0" max="100" step="5" value="${state.veil}" aria-label="${t.veil}"><b id="dsh-video-bg-veil-v">${state.veil}%</b></div>
					<div class="dsh-video-bg-row">
						<span>${t.fit}</span>
						<div class="dsh-video-bg-fit">
							<button id="dsh-video-bg-fit-cover" type="button">${t.cover}</button>
							<button id="dsh-video-bg-fit-contain" type="button">${t.contain}</button>
						</div>
					</div>
				</div>`;
			document.body.appendChild(control);

			note = control.querySelector("#dsh-video-bg-note");
			toggle = control.querySelector("#dsh-video-bg-toggle");
			collapse = control.querySelector("#dsh-video-bg-collapse");
			opacityInput = control.querySelector("#dsh-video-bg-opacity");
			opacityValue = control.querySelector("#dsh-video-bg-opacity-v");
			veilInput = control.querySelector("#dsh-video-bg-veil");
			veilValue = control.querySelector("#dsh-video-bg-veil-v");
			const coverButton = control.querySelector("#dsh-video-bg-fit-cover");
			const containButton = control.querySelector("#dsh-video-bg-fit-contain");

			scrim = document.createElement("div");
			scrim.id = SCRIM_ID;
			scrim.setAttribute("aria-hidden", "true");

			const setNote = (text) => {
				note.textContent = text;
			};
			const setProblem = (problem) => {
				if (problem) toggle.dataset.problem = "";
				else delete toggle.dataset.problem;
			};

			const syncPlayback = () => {
				if (video === null) return;
				const paused = video.paused;
				toggle.textContent = paused ? "▶" : "⏸";
				toggle.title = paused ? t.play : t.pause;
				toggle.setAttribute("aria-label", paused ? t.play : t.pause);
			};

			const syncAppearance = () => {
				if (video !== null) {
					video.style.opacity = String(state.opacity / 100);
					video.style.objectFit = state.fit;
				}
				if (scrim !== null) scrim.style.background = `rgba(6, 10, 16, ${state.veil / 100})`;
				opacityInput.value = String(state.opacity);
				opacityValue.textContent = `${state.opacity}%`;
				veilInput.value = String(state.veil);
				veilValue.textContent = `${state.veil}%`;
				if (state.fit === "contain") {
					containButton.dataset.active = "";
					delete coverButton.dataset.active;
				} else {
					coverButton.dataset.active = "";
					delete containButton.dataset.active;
				}
			};

			const syncOpen = () => {
				if (state.open) control.dataset.open = "";
				else delete control.dataset.open;
				collapse.textContent = state.open ? "▾" : "▴";
				collapse.title = state.open ? t.collapse : t.expand;
				collapse.setAttribute("aria-label", state.open ? t.collapse : t.expand);
			};

			const play = () => {
				if (video === null || disposed) return;
				const started = video.play();
				if (started !== void 0 && typeof started.catch === "function") {
					started.catch(() => {
						setNote(t.autoplayBlocked);
					});
				}
			};

			const createVideo = (rev) => {
				if (disposed) return;
				video = document.createElement("video");
				video.id = VIDEO_ID;
				video.muted = true;
				video.defaultMuted = true;
				video.loop = true;
				video.autoplay = true;
				video.preload = "auto";
				video.playsInline = true;
				video.setAttribute("playsinline", "");
				video.setAttribute("muted", "");
				video.setAttribute("aria-hidden", "true");
				video.addEventListener("error", () => {
					setProblem(true);
					setNote(t.loadFailed);
					console.warn("dsh-video-bg: video element failed", video?.error);
				}, { signal });
				video.addEventListener("waiting", () => setNote(t.waiting), { signal });
				video.addEventListener("playing", () => {
					setNote("");
					setProblem(false);
				}, { signal });
				video.addEventListener("canplay", () => {
					if (note.textContent === t.waiting) setNote("");
				}, { signal });
				video.addEventListener("play", syncPlayback, { signal });
				video.addEventListener("pause", syncPlayback, { signal });
				if (state.paused) {
					video.addEventListener("loadedmetadata", () => video?.pause(), { signal, once: true });
				}
				video.src = rev === "" ? MEDIA_URL : `${MEDIA_URL}?v=${encodeURIComponent(rev)}`;
				document.body.insertBefore(video, control);
				document.body.insertBefore(scrim, control);
				syncAppearance();
				syncPlayback();
				if (!state.paused) play();
			};

			const adoptServerDefaults = (defaults) => {
				if (defaults === null || typeof defaults !== "object") return;
				state.opacity = clamp(defaults.opacity, 0, 100, state.opacity);
				state.veil = clamp(defaults.veil, 0, 100, state.veil);
				state.fit = defaults.fit === "contain" ? "contain" : "cover";
				syncAppearance();
			};

			const reportStatus = (data) => {
				if (data !== null && typeof data === "object" && data.ok !== true) {
					setProblem(true);
					setNote(data.error === "missing" || data.error === "not-a-file" ? t.missing : t.unreadable);
					return false;
				}
				return true;
			};

			/* --- interaction wiring --- */
			toggle.addEventListener("click", () => {
				state.paused = !state.paused;
				persist(state);
				if (state.paused) {
					video?.pause();
					setNote("");
				} else {
					play();
				}
				syncPlayback();
			}, { signal });
			collapse.addEventListener("click", () => {
				state.open = !state.open;
				persist(state);
				syncOpen();
			}, { signal });
			opacityInput.addEventListener("input", () => {
				state.opacity = clamp(opacityInput.value, 0, 100, DEFAULT_STATE.opacity);
				persist(state);
				syncAppearance();
			}, { signal });
			veilInput.addEventListener("input", () => {
				state.veil = clamp(veilInput.value, 0, 100, DEFAULT_STATE.veil);
				persist(state);
				syncAppearance();
			}, { signal });
			coverButton.addEventListener("click", () => {
				state.fit = "cover";
				persist(state);
				syncAppearance();
			}, { signal });
			containButton.addEventListener("click", () => {
				state.fit = "contain";
				persist(state);
				syncAppearance();
			}, { signal });
			document.addEventListener("visibilitychange", () => {
				if (video === null) return;
				if (document.hidden) {
					if (!video.paused) {
						hiddenPaused = true;
						video.pause();
					}
				} else if (hiddenPaused) {
					hiddenPaused = false;
					if (!state.paused) play();
				}
			}, { signal });

			syncOpen();
			syncAppearance();

			/* --- discover the effective file and its revision, then start --- */
			const statusSignal =
				typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function"
					? AbortSignal.any([signal, AbortSignal.timeout(STATUS_TIMEOUT_MS)])
					: signal;
			fetch(STATUS_URL, { signal: statusSignal, cache: "no-store", credentials: "same-origin" })
				.then((response) => (response.ok ? response.json() : null))
				.then((data) => {
					if (disposed) return;
					const usable = reportStatus(data);
					if (usable && !stored) adoptServerDefaults(data.defaults);
					createVideo(usable && typeof data.rev === "string" ? data.rev : "");
				})
				.catch(() => {
					if (disposed) return;
					createVideo("");
				});

			return () => {
				disposed = true;
				abort.abort();
				try {
					if (video !== null) {
						video.pause();
						video.removeAttribute("src");
						video.load();
					}
				} catch {
					/* no-op */
				}
				video?.remove();
				scrim?.remove();
				control?.remove();
				style?.remove();
				document.body.removeAttribute(BODY_ATTR);
			};
		}

		/**
		 * Mount once the document body exists (the boot graph may materialize this
		 * bundle before `<body>` has been parsed) and tear down through the effect.
		 */
		function apply(ctx) {
			if (typeof document === "undefined" || typeof window === "undefined") return;
			ctx.effect(() => {
				let cleanup = null;
				let cancelled = false;
				const start = () => {
					if (cancelled || document.body === null) return;
					cleanup = mount();
				};
				if (document.body !== null) start();
				else document.addEventListener("DOMContentLoaded", start, { once: true });
				return () => {
					cancelled = true;
					document.removeEventListener("DOMContentLoaded", start);
					cleanup?.();
					cleanup = null;
				};
			}, "dsh-video-bg: video background");
		}

		exports.name = "video-bg";
		exports.apply = apply;
		return module.exports;
	}
});
