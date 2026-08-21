/**
 * dsh-video-bg — host half.
 *
 * Registers the /video-bg HTTP routes on the DSH web server:
 *   GET /video-bg/media   streams the configured local video with RFC 7233
 *                         single-range support (206/416), so the browser video
 *                         element can seek a large local file (this is how the
 *                         background video reaches the renderer without any
 *                         upload — the bytes stay on this machine).
 *   GET /video-bg/status  JSON metadata for diagnostics / the client badge.
 *
 * The video path is resolved in order: plugin config `videoPath` → env
 * `DSH_VIDEO_BG_PATH` → the bundled default `media/background.mp4` inside this
 * package (a missing file surfaces as a 404 from /video-bg/status and the
 * browser half shows a clear failure badge).
 */
import { createReadStream, promises as fsp } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Required service: the web route registry. */
export const inject = ["webServer"];

/** Bundled default background video, shipped inside this package (git/npm install). */
const BUNDLED_MEDIA_PATH = fileURLToPath(new URL("../media/background.mp4", import.meta.url));
const ROUTE_PREFIX = "/video-bg";
const MEDIA_PATH = "/video-bg/media";
const STATUS_PATH = "/video-bg/status";

const MIME_BY_EXT = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".ts": "video/mp2t"
};

function mimeOf(path) {
	return MIME_BY_EXT[extname(path).toLowerCase()] ?? "video/mp4";
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
 * @returns `null` (no range → full body), `"unsat"` (satisfiable range shape
 * but start past EOF → 416), or `{start, end}` (inclusive).
 */
function parseRange(header, size) {
	if (header === void 0 || header === "") return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (match === null) return null; // unsupported shape → ignore per RFC 7233
	const rawStart = match[1];
	const rawEnd = match[2];
	if (rawStart === "" && rawEnd === "") return null;
	let start;
	let end;
	if (rawStart === "") {
		// Suffix range: last N bytes.
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
	end = Math.min(end, size - 1);
	return { start, end };
}

function pipeFile(req, res, videoPath, start, end) {
	const stream = createReadStream(videoPath, { start, end, highWaterMark: 1024 * 1024 });
	stream.on("error", () => {
		res.destroy();
	});
	req.on("close", () => {
		stream.destroy();
	});
	stream.pipe(res);
}

async function serveStatus(req, res, videoPath) {
	try {
		const stat = await fsp.stat(videoPath);
		if (!stat.isFile()) {
			json(res, 400, { ok: false, error: "not-a-file", path: videoPath });
			return;
		}
		json(res, 200, {
			ok: true,
			path: videoPath,
			size: stat.size,
			mtime: stat.mtime.toISOString(),
			mime: mimeOf(videoPath)
		});
	} catch (error) {
		json(res, error?.code === "ENOENT" ? 404 : 500, {
			ok: false,
			error: "unreadable",
			path: videoPath
		});
	}
}

async function serveMedia(req, res, videoPath) {
	let stat;
	try {
		stat = await fsp.stat(videoPath);
	} catch (error) {
		json(res, error?.code === "ENOENT" ? 404 : 500, { ok: false, error: "unreadable" });
		return;
	}
	if (!stat.isFile()) {
		json(res, 400, { ok: false, error: "not-a-file" });
		return;
	}
	const size = stat.size;
	/* The media file is immutable for the lifetime of one host run (the path is
	 * resolved once at plugin start), so it is safe to advertise a long cache
	 * lifetime. This matters for Chromium's media pipeline: non-cacheable media
	 * responses (no-cache/no-store) disable the media cache and its aggressive
	 * read-ahead buffering, which causes "plays a second, stalls, plays again"
	 * starvation even against a fast local server. */
	const baseHeaders = {
		"content-type": mimeOf(videoPath),
		"accept-ranges": "bytes",
		"cache-control": "public, max-age=604800",
		"x-content-type-options": "nosniff"
	};
	const range = parseRange(req.headers.range, size);
	if (range === "unsat") {
		res.writeHead(416, {
			...baseHeaders,
			"content-range": `bytes */${size}`
		});
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
		pipeFile(req, res, videoPath, 0, size - 1);
		return;
	}
	res.writeHead(206, {
		...baseHeaders,
		"content-length": range.end - range.start + 1,
		"content-range": `bytes ${range.start}-${range.end}/${size}`
	});
	pipeFile(req, res, videoPath, range.start, range.end);
}

function effectiveVideoPath(config) {
	const candidate = config.videoPath ?? process.env.DSH_VIDEO_BG_PATH ?? BUNDLED_MEDIA_PATH;
	return resolve(String(candidate));
}

/**
 * Mount the video-background media routes.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - optional `{ videoPath }` override.
 */
export function apply(ctx, config = {}) {
	const videoPath = effectiveVideoPath(config);
	ctx.effect(() => {
		const handler = (req, res) => {
			const pathname = new URL(req.url ?? "/", "http://x").pathname;
			if (pathname === MEDIA_PATH) {
				void serveMedia(req, res, videoPath);
				return;
			}
			if (pathname === STATUS_PATH) {
				void serveStatus(req, res, videoPath);
				return;
			}
			json(res, 404, { ok: false, error: "not-found" });
		};
		const dispose = ctx.webServer.register({
			kind: "prefix",
			path: ROUTE_PREFIX,
			handler
		});
		ctx.logger.info(`dsh-video-bg: background video ready at ${MEDIA_PATH} (${videoPath})`);
		return () => {
			dispose();
			ctx.logger.info("dsh-video-bg: media routes disposed");
		};
	}, "dsh-video-bg: media routes");
}
