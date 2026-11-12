# Changing the content

How to change the questions, fuel games, flight events, rules, star chart and story, and what to check afterwards. After any change, run the tests:

```bash
cd client
npm test
```

## Questions

The question bank is `client/src/data/questions.json`, with one list of cards per topic: `general` (General knowledge), `mental` (Mental ability) and `technology`.

```json
{
  "general": [
    {
      "id": "g1",
      "level": "easy",
      "prompt": "How many planets are in the Solar System?",
      "choices": ["9", "8", "7", "10"],
      "answer": "8"
    }
  ]
}
```

- **`id`** must be unique across the whole bank.
- **`level`** is `easy`, `medium` or `hard`. Outer-ring systems ask easy questions, the middle ring medium ones, and the inner ring hard ones.
- **`choices`** must be exactly four different answers. The game shuffles them each time a card is asked, so don't write choices that depend on their order ("Both A and B", "All of the above").
- **`answer`** must match one of the choices exactly.
- Each topic needs at least 16 easy, 12 medium and 12 hard cards.

The tests check every one of these rules. A pilot doesn't see the same card twice in a run until that topic's level runs out. Adding a new topic takes code changes in `App.jsx` (the `DOMAINS` list, its icon in `DOMAIN_ICONS`, and the used-card sets in `Game`) and in the question bank test.

## Fuel games

The fuel games are listed in `FUEL_ROUNDS` in `client/src/game/fuelRounds.js`:

```js
{ id: "element", title: "Element check", how: "Name the element from its symbol.", per: 1, make: makeElementCard }
```

- **`title`** and **`how`** show above the game.
- **`per`** is how many right answers earn one credit. It evens out fast and slow games, so a typical player earns about 13 credits a minute.
- **A choice-card game** has a `make(rng)` function that returns a card: `{ prompt, choices, answer }`, with exactly four different choices. Optional fields: `ink` (a colour for the prompt), `gauge: true` (draws the choices as tank gauges), `worlds: true` (draws the choices as pictures of famous worlds) and `row: { shown, at, gap }` (the Planet order row: the shown planet's place and the gap's place in `PLANET_ORDER`). A world that appears on a `worlds` card needs a look in `WORLD_LOOKS` in `client/src/three/sprites.js`, and a radius in `WORLD_RADII` if it's one for Biggest world.
- **An interactive game** has no `make`. It's a component in `App.jsx` that takes `{ onMark, locked }`, ignores presses while `locked` (the game is jammed after a miss), and calls `onMark("right")`, `onMark("wrong")` or `onMark("skip")` for each try. Register it in `FUEL_GAMES` under the same `id`.

When adding or removing a game:

- Update the count in the test "nine different fuel rounds".
- Update the games table in [Playing Nova Grid](playing.md).

The admin panel's fuel game picker lists `FUEL_ROUNDS` by itself.

## Flight events

The flight events are listed in `FLIGHT_EVENTS` in `client/src/game/events.js`:

```js
{
  id: "storm",
  title: "Ion storm",
  text: "A storm is crossing your path.",
  options: [
    { label: "Raise shields", credits: -5 },
    { label: "Wait it out", time: -30 },
  ],
}
```

- Each event has exactly **two options**. An option can change `fuel`, `credits` and `time` (in seconds; negative costs time).
- An option that would take fuel or credits below zero can't be picked, so **one option must always be open**. "Fly on", or an option that only costs time, does that.
- 1 fuel and 10 seconds are worth the same on the board, which helps keep the two options balanced.
- `EVENT_CHANCE` (one in three) sets how often a lane flight brings an event.

The tests check the two-option and always-open rules. The admin panel lists the events by itself. Update the events table in [Playing Nova Grid](playing.md) to match.

## Rules and balance

Every rule is a constant or a pure function in `client/src/game/rules.js`:

| Constant | What it sets | Now |
|---|---|---|
| `START_FUEL`, `START_POWER`, `START_CREDITS` | What a run starts with | 10, 10, 0 |
| `POWER_CAP`, `POWER_TICK_MS` | Power recharge inside a system | up to 10, 1 every 20 s |
| `MAP_SCAN_POWER`, `SCAN_POWER` | Cost of a star map scan, and of "Scan first" when landing | 1, 1 |
| `HOP_K` | Power per unit of distance for a hop | 0.0167 |
| `SHOP_PACKS` | The shop's packs | 5, 10 or 15 fuel; 5 power |
| `HAB_TOP`, `HAB_RAMP_MS` | The time part of the landing chance, and how long it takes to reach the top | 60%, 15 minutes |
| `HAB_RIGHT`, `HAB_CAP` | A right answer's bonus, as a share of the chance, and the highest chance | a tenth (×1.1), 65% |
| `LAND_FAIL_MS` | Time lost to a failed landing | 30 s |
| `TOXIC_LIMIT` | The safe limit shown in the readings | 50 ppm |
| `STREAK` | Right answers in a row for a bonus credit | 5 |

The run's length (`ROUND_MS`, 15 minutes) and the question time (`QUESTION_MS`, 60 seconds) are in `App.jsx`. If you change the run's length, change `HAB_RAMP_MS` to match.

After changing a rule:

1. **Update the tests** whose numbers change. Many test the rules with worked numbers on purpose.
2. **Check the words.** The How to play reel takes its numbers from the rules, but its captions are written by hand (`client/src/intro/HowTo.jsx`). The tips (`TIPS` in `App.jsx`), the intro film's captions and [Playing Nova Grid](playing.md) also mention the numbers.
3. **Mind the balance.** The chart's 14 possible homes and the lane prices were tuned so a typical player wins about half their runs. Cheaper lanes or more possible homes make the game much easier.

## The star chart

The chart is `CHART` in `client/src/game/map.js`, one row per system:

```js
["outer", 3.78, 0.81, "FTT"],
```

That's the ring, the distance from the station, the angle, and its planets from the sun outward (`F` a fuel stop, `T` a possible home). `LANE_ROWS` lists the lanes by row number (`-1` is the station). The tests check that every system has 1 to 3 fuel stops and up to 2 possible homes, and that the lanes join every system without crossing.

The names come from `STARS`, `TEST_NAMES` and `FUEL_NAMES`, and are shuffled on every load. `STAR_KINDS` decides what each system's sun looks like, and doesn't change how it plays.

## The story

- **The 3D intro film:** `CAPTIONS` at the top of `client/src/intro/Intro3D.jsx`, timed against the film's constants just above it.
- **The 2D fallback film:** `CAPTIONS` in `client/src/intro/ClassicIntro.jsx`. Keep it telling the same story.
- **How to play:** `SCENES` in `client/src/intro/HowTo.jsx`, one `title` and `text` per scene.
- **The tips:** `TIPS` in `App.jsx`.

Several of these mention the 15 minutes, so update them together if the run's length changes.
