// ImgShare – Cloudflare Pages (Advanced mode)
// Biến môi trường cần có: IMGBB_API_KEY (Settings > Variables and Secrets, loại Secret)
const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), {
  status: s, headers: { "content-type": "application/json; charset=utf-8", ...h }
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    // 1) Tải ảnh lên ImgBB (key nằm phía máy chủ)
    if (p === "/api/upload") {
      if (request.method !== "POST") return json({ error: "Chỉ hỗ trợ POST" }, 405);
      if (!env.IMGBB_API_KEY) return json({ error: "Máy chủ chưa cấu hình IMGBB_API_KEY" }, 500);
      try {
        const ct = request.headers.get("content-type") || "";
        if (!ct.includes("multipart/form-data")) return json({ error: "Yêu cầu không hợp lệ" }, 400);
        const form = await request.formData();
        const file = form.get("image");
        if (!file || typeof file === "string") return json({ error: "Không có file ảnh" }, 400);
        if (file.size > 32 * 1024 * 1024) return json({ error: "Ảnh vượt quá 32MB" }, 413);
        const fd = new FormData();
        fd.append("image", file, file.name || "image");
        const r = await fetch("https://api.imgbb.com/1/upload?key=" + encodeURIComponent(env.IMGBB_API_KEY), { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (!d.success) return json({ error: d.error?.message || "ImgBB từ chối ảnh này" }, 502);
        const i = d.data;
        return json({
          id: i.id, url: i.url, path: new URL(i.url).pathname.slice(1),
          thumb: i.thumb?.url || i.url, width: +i.width, height: +i.height,
          size: +i.size, title: i.title, mime: i.image?.mime || "", time: +i.time
        });
      } catch (e) { return json({ error: "Lỗi máy chủ: " + e.message }, 500); }
    }

    // 2) Tra link ảnh từ ID (đọc og:image của ibb.co/<id>)
    if (p === "/api/image") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9]{3,20}$/.test(id)) return json({ error: "ID không hợp lệ" }, 400);
      const cache = caches.default, key = new Request(url.origin + "/api/image?id=" + id);
      const hit = await cache.match(key); if (hit) return hit;
      const r = await fetch("https://ibb.co/" + id, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!r.ok) return json({ error: "Không tìm thấy ảnh" }, 404);
      const html = await r.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
      if (!m) return json({ error: "Không tìm thấy ảnh" }, 404);
      const u = new URL(m[1]);
      const res = json({ id, url: m[1], path: u.hostname === "i.ibb.co" ? u.pathname.slice(1) : "" }, 200, { "cache-control": "public, max-age=86400" });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    // 3) Proxy ảnh qua tên miền của bạn: /img/<hash>/<file>
    //    (ảnh hiển thị ổn định cả ở nơi chặn i.ibb.co, và cho phép nút "Tải xuống")
    if (p.startsWith("/img/")) {
      const path = p.slice(5);
      if (!/^[A-Za-z0-9]+\/[^\/]+$/.test(path)) return new Response("Bad path", { status: 400 });
      const r = await fetch("https://i.ibb.co/" + path, { cf: { cacheEverything: true, cacheTtl: 2592000 } });
      if (!r.ok) return new Response("Not found", { status: r.status });
      const h = new Headers();
      h.set("content-type", r.headers.get("content-type") || "image/jpeg");
      h.set("cache-control", "public, max-age=2592000, immutable");
      if (url.searchParams.has("dl")) h.set("content-disposition", `attachment; filename="${decodeURIComponent(path.split("/")[1]).replace(/"/g, "")}"`);
      return new Response(r.body, { headers: h });
    }

    return env.ASSETS.fetch(request);
  }
};
