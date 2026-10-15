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

const insert = db.prepare("INSERT INTO scores (name, score, finished_at) VALUES (?, ?, ?)");
const list = db.prepare(
  "SELECT id, name, score, finished_at FROM scores ORDER BY score DESC, finished_at ASC, id ASC"
);

// Canonical UTC so TEXT order is time order across offsets.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseScore(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a JSON object" };
  }
  const { name, score, finishedAt } = body;
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "name must be a non-empty string" };
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return { error: "score must be a finite number" };
  }
  if (typeof finishedAt !== "string" || !ISO.test(finishedAt) || Number.isNaN(Date.parse(finishedAt))) {
    return { error: "finishedAt must be an ISO-8601 string" };
  }
  return { name: name.trim(), score, finishedAt: new Date(finishedAt).toISOString() };
}

function toJson(row) {
  return { id: row.id, name: row.name, score: row.score, finishedAt: row.finished_at };
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
  const info = insert.run(parsed.name, parsed.score, parsed.finishedAt);
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    name: parsed.name,
    score: parsed.score,
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
