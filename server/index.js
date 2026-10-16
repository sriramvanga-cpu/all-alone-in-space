const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "scores.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  score REAL NOT NULL,
  finished_at TEXT NOT NULL
)`);
const have = new Set(db.prepare("PRAGMA table_info(scores)").all().map((col) => col.name));
for (const [name, def] of [
  ["settled", "INTEGER NOT NULL DEFAULT 0"],
  ["time_left", "INTEGER NOT NULL DEFAULT 0"],
  ["worlds", "INTEGER NOT NULL DEFAULT 0"],
  ["fuel", "REAL NOT NULL DEFAULT 0"],
]) {
  if (!have.has(name)) {
    db.exec(`ALTER TABLE scores ADD COLUMN ${name} ${def}`);
    if (name === "fuel") db.exec("UPDATE scores SET fuel = score");
  }
}

const insert = db.prepare(
  "INSERT INTO scores (name, score, finished_at, settled, time_left, worlds, fuel) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
// Same order as compareRuns: wins, time left, fuel score; losses, worlds, then who lasted.
const list = db.prepare(`SELECT id, name, score, finished_at, settled, time_left, worlds, fuel FROM scores
  ORDER BY settled DESC,
    CASE WHEN settled = 1 THEN time_left ELSE worlds END DESC,
    CASE WHEN settled = 1 THEN fuel ELSE -time_left END DESC,
    id ASC`);

// Canonical UTC so TEXT order is time order across offsets.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseScore(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const { name, finishedAt } = body;
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "name must be a non-empty string" };
  }
  if (typeof finishedAt !== "string" || !ISO.test(finishedAt) || Number.isNaN(Date.parse(finishedAt))) {
    return { error: "finishedAt must be an ISO-8601 string" };
  }
  const when = new Date(finishedAt).toISOString();
  if (typeof body.settled !== "boolean") {
    if (typeof body.score !== "number" || !Number.isFinite(body.score)) {
      return { error: "score must be a finite number" };
    }
    return { name: name.trim(), fuel: body.score, settled: false, timeLeft: 0, worlds: 0, finishedAt: when };
  }
  const whole = (n, max) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
  if (!whole(body.timeLeft, 24 * 60 * 60) || !whole(body.worlds, 18)) {
    return { error: "timeLeft and worlds must be whole numbers" };
  }
  if (typeof body.fuel !== "number" || !Number.isFinite(body.fuel)) {
    return { error: "fuel must be a finite number" };
  }
  return {
    name: name.trim(),
    fuel: body.fuel,
    settled: body.settled,
    timeLeft: body.timeLeft,
    worlds: body.worlds,
    finishedAt: when,
  };
}

function toJson(row) {
  return {
    id: row.id,
    name: row.name,
    score: row.score,
    fuel: row.fuel,
    settled: row.settled === 1,
    timeLeft: row.time_left,
    worlds: row.worlds,
    finishedAt: row.finished_at,
  };
}

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

app.post("/api/scores", (req, res) => {
  const parsed = parseScore(req.body);
  if (parsed.error) return res.status(400).json(parsed);
  const info = insert.run(
    parsed.name,
    parsed.fuel,
    parsed.finishedAt,
    parsed.settled ? 1 : 0,
    parsed.timeLeft,
    parsed.worlds,
    parsed.fuel,
  );
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    name: parsed.name,
    fuel: parsed.fuel,
    settled: parsed.settled,
    timeLeft: parsed.timeLeft,
    worlds: parsed.worlds,
    finishedAt: parsed.finishedAt,
  });
});

app.get("/api/leaderboard", (_req, res) => {
  res.json(list.all().map(toJson));
});

app.use((err, _req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
  next(err);
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${port}`);
});
