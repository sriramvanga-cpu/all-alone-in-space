import { db, parseScore, readBody, send, toJson } from "./store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "invalid JSON" });
  }
  const parsed = parseScore(body);
  if (parsed.error) return send(res, 400, parsed);
  try {
    const sql = await db();
    const rows = await sql`
      INSERT INTO scores (name, score, finished_at, settled, time_left, worlds, fuel)
      VALUES (
        ${parsed.name},
        ${parsed.fuel},
        ${parsed.finishedAt},
        ${parsed.settled},
        ${parsed.timeLeft},
        ${parsed.worlds},
        ${parsed.fuel}
      )
      RETURNING id, name, fuel, settled, time_left, worlds, finished_at
    `;
    return send(res, 201, toJson(rows[0]));
  } catch (err) {
    const missing = err?.code === "NO_DATABASE";
    return send(res, missing ? 503 : 500, { error: missing ? "DATABASE_URL is not set" : "database" });
  }
}
