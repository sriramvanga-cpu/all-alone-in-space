import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScore } from "./store.js";

const when = "2026-10-16T13:16:00.000Z";

test("score posts keep settled, time left, worlds, and fuel", () => {
  const parsed = parseScore({
    name: " Kirk ",
    settled: true,
    timeLeft: 120,
    worlds: 2,
    fuel: -1.5,
    finishedAt: when,
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.name, "Kirk");
  assert.equal(parsed.settled, true);
  assert.equal(parsed.timeLeft, 120);
  assert.equal(parsed.worlds, 2);
  assert.equal(parsed.fuel, -1.5);
});

test("a score post without settled is an old loss", () => {
  const parsed = parseScore({ name: "Sulu", score: 3, finishedAt: when });
  assert.deepEqual(
    { settled: parsed.settled, timeLeft: parsed.timeLeft, worlds: parsed.worlds, fuel: parsed.fuel },
    { settled: false, timeLeft: 0, worlds: 0, fuel: 3 },
  );
});

test("a long run with leftover fuel is accepted", () => {
  const parsed = parseScore({ name: "Scott", settled: false, timeLeft: 10, worlds: 40, fuel: 50, finishedAt: when });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.fuel, 50);
  assert.equal(parsed.worlds, 40);
});

test("a score post rejects a bad clock", () => {
  const parsed = parseScore({ name: "Uhura", settled: false, timeLeft: 1.5, worlds: 0, fuel: 0, finishedAt: when });
  assert.equal(parsed.error, "timeLeft and worlds must be whole numbers");
});
