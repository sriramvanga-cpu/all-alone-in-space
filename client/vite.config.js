import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import scores from "./api/scores.js";
import leaderboard from "./api/leaderboard.js";
import live from "./api/live.js";

function leaderboardApi() {
  return {
    name: "leaderboard-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const handle = url === "/api/scores" ? scores : url === "/api/leaderboard" ? leaderboard : url === "/api/live" ? live : null;
        if (!handle) return next();
        try {
          await handle(req, res);
        } catch {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "database" }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), leaderboardApi()],
  server: { host: true, port: 5173, strictPort: true },
});
