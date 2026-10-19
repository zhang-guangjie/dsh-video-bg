/**
 * dsh-video-bg — host half.
 *
 * Registers the two `/video-bg` HTTP routes on the DSH web server:
 *
 *   GET /video-bg/media   streams the configured local video with RFC 7233
 *                         single-range support (206/416) and HEAD, so a browser
 *                         or the Desktop renderer can play and seek a large
 *                         file without uploading a single byte.
 *   GET /video-bg/status  JSON diagnostics and presentation defaults for the
 *                         browser half (effective size/revision, source, and
 *                         the configured fit/opacity/veil defaults).
 *
 * Both work unchanged in the two official DSH surfaces: a plain `dsh web`
 * browser page requests them same-origin, and DSH Desktop forwards non-document
 * `dsh-app://app/*` requests to this same host with its authentication cookie.
 *
 * Video path resolution order:
 *   1. plugin row config `videoPath`   (profile cordis.patch.yml)
 *   2. environment variable `DSH_VIDEO_BG_PATH`
 *   3. bundled `media/background.mp4` inside this package
 *
 * A missing or unreadable file never fails the plugin: `/status` reports the
 * reason and the browser half shows a clear failure badge.
 *
 * @module dsh-video-bg
 */

import { createReadStream, promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin name. */
export const name = "video-bg";

/** Required service: the web route registry. */
export const inject = ["webServer"];

const ROUTE_PREFIX = "/video-bg";
const MEDIA_PATH = "/video-bg/media";
const STATUS_PATH = "/video-bg/status";

/** Bundled default video, shipped inside this package. */
const BUNDLED_MEDIA_PATH = fileURLToPath(new URL("../media/background.mp4", import.meta.url));

/** Presentation defaults, overridable by row config and seeded into the browser. */
const DEFAULT_APPEARANCE = Object.freeze({ fit: "cover", opacity: 55, veil: 25 });

/** Accepted `fit` values (CSS `object-fit`). */
const FITS = new Set(["cover", "contain"]);

const MIME_BY_EXT = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".ogv": "video/ogg",
	".ogg": "video/ogg",
	".ts": "video/mp2t"
};

function mimeOf(path) {
	return MIME_BY_EXT[extname(path).toLowerCase()] ?? "video/mp4";
}

function clamp(value, min, max, fallback) {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

/** Expand a leading `~` / `~/` / `~\` against the OS home directory. */
function expandHome(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return resolve(homedir(), value.slice(2));
	return value;
}

/**
 * Resolve the effective options for one plugin instance.
 * @param config - row config from the profile patch (untrusted shape).
 */
function readOptions(config) {
	const raw = config !== null && typeof config === "object" ? config : {};
	const configured = typeof raw.videoPath === "string" && raw.videoPath.trim() !== "" ? expandHome(raw.videoPath.trim()) : void 0;
	const environment =
		typeof process.env.DSH_VIDEO_BG_PATH === "string" && process.env.DSH_VIDEO_BG_PATH.trim() !== ""
			? expandHome(process.env.DSH_VIDEO_BG_PATH.trim())
			: void 0;
	const source = configured !== void 0 ? "config" : environment !== void 0 ? "environment" : "bundled";
	return {
		videoPath: resolve(configured ?? environment ?? BUNDLED_MEDIA_PATH),
		source,
		fit: FITS.has(raw.fit) ? raw.fit : DEFAULT_APPEARANCE.fit,
		opacity: clamp(raw.opacity, 0, 100, DEFAULT_APPEARANCE.opacity),
		veil: clamp(raw.veil, 0, 100, DEFAULT_APPEARANCE.veil)
	};
}

/** Opaque revision for one file generation; used as cache-busting media query. */
function revisionOf(stat) {
	return `${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}`;
}

function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}

/**
 * Parse a single-range `Range: bytes=…` header.
 * @returns `null` (no usable range → full body), `"unsat"` (satisfiable shape
 * but start past EOF → 416), or `{ start, end }` inclusive.
 */
function parseRange(header, size) {
	if (header === void 0 || header === "") return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
	if (match === null) return null;
	const rawStart = match[1];
	const rawEnd = match[2];
	if (rawStart === "" && rawEnd === "") return null;
	let start;
	let end;
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd === "" ? size - 1 : Number(rawEnd);
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
	}
	if (start >= size) return "unsat";
	return { start, end: Math.min(end, size - 1) };
}

/** Stream `[start, end]` of the file and release the stream on client abort. */
function pipeFile(req, res, videoPath, start, end) {
	const stream = createReadStream(videoPath, { start, end, highWaterMark: 1024 * 1024 });
	stream.on("error", () => res.destroy());
	req.on("close", () => stream.destroy());
	stream.pipe(res);
}

async function serveStatus(res, options) {
	const base = {
		path: options.videoPath,
		source: options.source,
		defaults: {
			fit: options.fit,
			opacity: options.opacity,
			veil: options.veil
		}
	};
	try {
		const stat = await fsp.stat(options.videoPath);
		if (!stat.isFile()) {
			json(res, 200, { ok: false, error: "not-a-file", ...base });
			return;
		}
		json(res, 200, {
			ok: true,
			rev: revisionOf(stat),
			size: stat.size,
			mtimeMs: Math.round(stat.mtimeMs),
			mime: mimeOf(options.videoPath),
			...base
		});
	} catch (error) {
		json(res, 200, {
			ok: false,
			error: error?.code === "ENOENT" ? "missing" : "unreadable",
			...base
		});
	}
}

async function serveMedia(req, res, options) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, {
			allow: "GET, HEAD",
			"content-type": "text/plain; charset=utf-8",
			"content-length": 18
		});
		res.end("method not allowed");
		return;
	}
	let stat;
	try {
		stat = await fsp.stat(options.videoPath);
	} catch (error) {
		json(res, error?.code === "ENOENT" ? 404 : 500, { ok: false, error: "unreadable" });
		return;
	}
	if (!stat.isFile()) {
		json(res, 400, { ok: false, error: "not-a-file" });
		return;
	}
	const size = stat.size;
	const rev = revisionOf(stat);
	/* The URL carries the file revision as a query, so the bytes for one URL are
	 * immutable for the browser cache. A long cache lifetime keeps Chromium's
	 * media pipeline read-ahead enabled; `no-store` media responses are known to
	 * produce a choose-a-range / stall / play pattern against local servers. */
	const baseHeaders = {
		"content-type": mimeOf(options.videoPath),
		"accept-ranges": "bytes",
		"cache-control": "public, max-age=604800, immutable",
		etag: `"${rev}"`,
		"last-modified": stat.mtime.toUTCString(),
		"x-content-type-options": "nosniff"
	};
	const range = parseRange(req.headers.range, size);
	if (range === "unsat") {
		res.writeHead(416, { ...baseHeaders, "content-range": `bytes */${size}` });
		res.end();
		return;
	}
	if (req.method === "HEAD") {
		if (range === null) {
			res.writeHead(200, { ...baseHeaders, "content-length": size });
		} else {
			res.writeHead(206, {
				...baseHeaders,
				"content-length": range.end - range.start + 1,
				"content-range": `bytes ${range.start}-${range.end}/${size}`
			});
		}
		res.end();
		return;
	}
	if (range === null) {
		res.writeHead(200, { ...baseHeaders, "content-length": size });
		pipeFile(req, res, options.videoPath, 0, size - 1);
		return;
	}
	res.writeHead(206, {
		...baseHeaders,
		"content-length": range.end - range.start + 1,
		"content-range": `bytes ${range.start}-${range.end}/${size}`
	});
	pipeFile(req, res, options.videoPath, range.start, range.end);
}

/**
 * Mount the video-background routes.
 * @param ctx - plugin context carrying the `webServer` service.
 * @param config - optional `{ videoPath, fit, opacity, veil }`.
 */
export function apply(ctx, config = {}) {
	const options = readOptions(config);
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "prefix",
			path: ROUTE_PREFIX,
			handler(req, res) {
				let pathname;
				try {
					pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
				} catch {
					json(res, 400, { ok: false, error: "bad-request" });
					return;
				}
				if (pathname === MEDIA_PATH) {
					void serveMedia(req, res, options);
					return;
				}
				if (pathname === STATUS_PATH) {
					void serveStatus(res, options);
					return;
				}
				json(res, 404, { ok: false, error: "not-found" });
			}
		});
		ctx.logger?.info?.(`dsh-video-bg: serving ${options.source} video at ${MEDIA_PATH} (${options.videoPath})`);
		/* Surface a missing default early for the log-reading maintainer without
		 * failing the plugin: the UI owns the user-facing failure. */
		void fsp
			.stat(options.videoPath)
			.then((stat) => {
				if (!stat.isFile()) ctx.logger?.warn?.(`dsh-video-bg: ${options.videoPath} is not a regular file`);
			})
			.catch((error) => {
				ctx.logger?.warn?.(`dsh-video-bg: cannot read ${options.videoPath} (${error?.code ?? error})`);
			});
		return () => {
			dispose();
			ctx.logger?.info?.("dsh-video-bg: media routes disposed");
		};
	}, "dsh-video-bg: media routes");
}
