import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/<repo>/
  // If you deploy to the root (custom domain or <user>.github.io), change this to "/".
  base: "/zombie-recoil/",
  server: {
    middlewareMode: false,
  },
  plugins: [
    {
      name: "zombie-recoil-save-map",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "POST" || req.url !== "/api/save-map") return next();

          try {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            await new Promise((resolve) => req.on("end", resolve));

            if (!body || body.trim().length === 0) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Empty request body" }));
              return;
            }

            const json = JSON.parse(body || "null");
            if (!Array.isArray(json)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Body must be a JSON array" }));
              return;
            }

            console.log("Writing to level.json:", json.length, "items");
            const outPath = path.join(server.config.root, "public", "maps", "level.json");
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(json, null, 2) + "\n", "utf-8");
            console.log(`[save-map] Wrote ${outPath} (${json.length} objects)`);

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, written: "/maps/level.json" }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: e?.message ?? "Failed to save map" }));
          }
        });
      },
    },
  ],
});

