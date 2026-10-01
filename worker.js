const videoCache = new Map();
const VIDEO_PATHS = new Set([
  "/erklaerfilm.mp4",
  "/erklaerfilm-de.mp4",
  "/erklaerfilm-en.mp4",
  "/erklaervideo.mp4",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/anfrage") {
      return handleContact(request);
    }
    if (VIDEO_PATHS.has(url.pathname)) {
      return serveVideo(request, env, url.pathname);
    }
    return env.ASSETS.fetch(request);
  },
};

async function videoBytes(request, env, pathname) {
  if (videoCache.has(pathname)) return videoCache.get(pathname);
  const assetUrl = new URL(pathname, request.url);
  const assetRes = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  if (!assetRes.ok) return null;
  const bytes = await assetRes.arrayBuffer();
  videoCache.set(pathname, bytes);
  return bytes;
}

async function serveVideo(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const data = await videoBytes(request, env, pathname);
  if (!data) return new Response("Video nicht gefunden", { status: 404 });
  const size = data.byteLength;
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const range = request.headers.get("Range");
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(request.method === "HEAD" ? null : data, { status: 200, headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }
  end = Math.min(end, size - 1);
  const slice = data.slice(start, end + 1);
  headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(slice.byteLength);
  return new Response(request.method === "HEAD" ? null : slice, { status: 206, headers });
}

async function handleContact(request) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }
  const name = clean(data.name, 120);
  const company = clean(data.company, 160);
  const email = clean(data.email, 160);
  const phone = clean(data.phone, 40);
  const message = clean(data.message, 4000);
  if (clean(data.hp_email || "", 200) || clean(data._honey || "", 200)) {
    return json({ ok: true });
  }
  if (name.length < 2 || company.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 6 || message.length < 10) {
    return json({ ok: false, error: "invalid" }, 400);
  }
  try {
    const response = await fetch("https://formsubmit.co/ajax/kontakt@hitekki.ch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://hitekki.ch",
        Referer: "https://hitekki.ch/",
      },
      body: JSON.stringify({
        name,
        company,
        email,
        phone,
        message,
        _subject: `Anfrage von ${company}`,
        _template: "table",
        _captcha: "false",
        _replyto: email,
      }),
    });
    const result = await response.json();
    const success = result.success === true || result.success === "true";
    if (!success) return json({ ok: false, error: "send", message: result.message || "" }, 502);
  } catch {
    return json({ ok: false, error: "send" }, 502);
  }
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clean(value, max) {
  return String(value ?? "").replace(/\r/g, "").trim().slice(0, max);
}