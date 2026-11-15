// Cloudflare Pages - Advanced mode worker
// API key lấy từ biến môi trường IMGBB_API_KEY (Settings > Environment variables)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

    if (url.pathname === "/api/upload" && request.method === "POST") {
      if (!env.IMGBB_API_KEY) return json({ error: "Chưa cấu hình IMGBB_API_KEY" }, 500);
      try {
        const form = await request.formData();
        const file = form.get("image");
        if (!file || typeof file === "string") return json({ error: "Không có file ảnh" }, 400);
        if (file.size > 32 * 1024 * 1024) return json({ error: "Ảnh vượt quá 32MB" }, 413);
        const fd = new FormData();
        fd.append("image", file, file.name || "image");
        const r = await fetch("https://api.imgbb.com/1/upload?key=" + encodeURIComponent(env.IMGBB_API_KEY), { method: "POST", body: fd });
        const d = await r.json();
        if (!d.success) return json({ error: d.error?.message || "Upload thất bại" }, 502);
        const i = d.data;
        return json({ id: i.id, url: i.url, path: new URL(i.url).pathname.slice(1), width: i.width, height: i.height, size: i.size, title: i.title });
      } catch (e) { return json({ error: "Lỗi máy chủ: " + e.message }, 500); }
    }

    // Tra cứu link ảnh trực tiếp từ ID (đọc og:image của trang ibb.co/<id>)
    if (url.pathname === "/api/image") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9]{3,20}$/.test(id)) return json({ error: "ID không hợp lệ" }, 400);
      const cache = caches.default, key = new Request(url.origin + "/api/image?id=" + id);
      const hit = await cache.match(key); if (hit) return hit;
      const r = await fetch("https://ibb.co/" + id, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!r.ok) return json({ error: "Không tìm thấy ảnh" }, 404);
      const html = await r.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
      if (!m) return json({ error: "Không tìm thấy ảnh" }, 404);
      const res = json({ id, url: m[1] });
      res.headers.set("cache-control", "public, max-age=86400");
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }

    return env.ASSETS.fetch(request);
  }
};
