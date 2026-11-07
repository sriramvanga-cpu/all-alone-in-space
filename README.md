# Nova Grid

A 15-minute space game for a college fest. Vulcan has broken apart, and the player captains the last starship with 15 minutes of air left. They fly from star to star, refuel by playing quick fuel games, answer a question at each world that could be home, and try to land on one before the clock runs out. A display board shows the best pilots live.

Live at <https://client-ten-phi-98.vercel.app>, with the board at `/board`.

## A run

1. **Registration:** the pilot's name and phone number. The phone is only used to contact prize winners.
2. **Intro film** (about 28 seconds, skippable): Vulcan breaks up, the last shuttle reaches the starship, the blast damages life support, and a scan of the stars ahead shows the mission.
3. **How to play:** six short scenes drawn in the game's own art: goal, fly, hop, refuel, answer, land. Its last button, or Skip, starts the 15-minute clock.
4. **The run** on the star map and the planetary maps (rules below). The first time each part of the game appears, a tip with a looping clip explains it, and the clock waits while it's open.
5. **End screen:** the result, the run's stats and its rank. The score goes to the board.

With reduced motion turned on, the film is skipped and the reel shows still frames.

## Rules

The numbers come from `client/src/game/rules.js`.

- **Start:** 10 fuel, 10 power, 0 credits, 15:00 on the clock.
- **Star map:** a scan (1 power) shows the systems one lane away. Flying a lane costs fuel by its length. About one lane flight in three (never the first) brings an event with two options, each trading fuel, time or credits.
- **Solar systems:** hopping between planets costs power by how far apart they are right now. Inside a system, power recharges by 1 every 20 seconds, up to 10.
- **Fuel stops** (planets with a drop): a one-minute fuel game earns credits, with a bonus credit for every 5 right in a row. There are seven games, shuffled per pilot. Then the shop sells 5 fuel for 10 credits, 10 for 18, 15 for 25, or 5 power for 6. Getting more than 1 in 10 wrong usually makes fuel cost more.
- **Possible homes** (planets marked !): one 60-second question in general knowledge, mental ability or technology (outer rings easy, inner rings hard). Then the landing:
  - The chance comes from the time flown, from 0% rising to 60% at 15 minutes, slowly at first.
  - A right answer adds 10 (up to 65%) and pays 15 credits. A wrong one halves the chance and usually makes fuel cost more.
  - "Scan first" (1 power) checks a second landing site if the first is toxic.
  - A failed landing costs 30 seconds, and each planet can be tried once.
- **Win:** settle on a habitable world. Points = fuel left + 1 per 10 seconds left.
- **Lose:** the clock runs out, or you're stranded, with no lane you can afford and no planet left to try.
- **Board:** wins rank above every loss, by points. Losses rank by more worlds, then more fuel left, then who lasted longer.

## Admin mode

Enter `admin` as both name and phone to start a test run. It never goes to the board. Fuel, power and credits stay topped up, and the clock gets a day.

- **Admin panel** (bottom-left button):
  - Switch the endless top-up off, or set exact fuel, power and credits.
  - Force every landing habitable or toxic.
  - Set the time left (15:00, 5:00, 1:00, 0:10 or back to the day), or fast-forward 1 or 5 minutes to raise the landing odds.
  - Jump anywhere: tap any system or open planet to go there at once.
  - Show the right answer on questions and fuel cards.
  - Pick the event for the next lane flight.
  - Replay the intro film, the How to play reel or the first-time tips.
- **At fuel stops:** a picker to play any of the seven fuel games, and a button to leave at once.
- **After a habitable landing:** "Settle here" ends the run with the win, and "Keep flying" goes back to the map.

## Display board

Open `/board` on the display screen. It checks for new scores every 3 seconds and shows the top three on a podium and the rest of the top 10 in a table. Before anyone has finished a run, it shows an invitation instead.

## Development

```bash
cd client
npm install
npm test
npm run dev
```

`npm test` checks the rules and the scores API's input handling. `npm run dev` starts Vite on port 5173 and serves the scores API from `client/api` alongside the game. `npm run build` builds into `client/dist`.

Scores are stored in Neon Postgres:

- **Production** reads `DATABASE_URL` from the Vercel project settings, which point at the `production` branch.
- **Local dev** reads `DATABASE_URL` from `.env.local` at the repo root, which points at the `dev` branch, so test runs never reach the fest board.
- **No database:** run `DATABASE_URL= npm run dev`. The API then answers 503, and the board shows Offline.

The game posts scores to `/api/scores` on the same host (or on `VITE_API_URL`, if set at build time), and `/board` reads `/api/leaderboard`. If a post fails, the game queues it in the browser and retries every few seconds.

The question bank is `client/src/data/questions.json`: 40 cards each for general knowledge, mental ability and technology, graded easy, medium or hard. Each card has four choices and one right answer.

## Deploying

```bash
cd client
npx vercel --prod
```

Day-to-day work happens on the `experimental` branch. `main` is kept as the last known-good version to roll back to.

## Code layout

- `client/src/App.jsx`: the game's screens, maps, top bar, fuel games, shop, end screen, board and admin panel.
- `client/src/game/`: the rules (with their tests), the star chart, the fuel games and the flight events.
- `client/src/intro/`: the 3D intro film, its 2D fallback for machines without WebGL, and the How to play reel.
- `client/src/three/`: three.js art (planets, stars, the black hole, asteroids, the ship and the station), rendered once into images for the maps.
- `client/src/art/`: the vector map art and the warp tunnel.
- `client/src/sound.js`: synthesized sound effects and the engine hum.
- `client/api/`: the scores API, served by Vite locally and by Vercel functions in production.

## Credits

Planet textures and the Milky Way panorama in `client/public/textures/` are from [Solar System Scope](https://www.solarsystemscope.com/textures/) (based on NASA mission data), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They were resized and the sky brightened for the game. The 3D ships and station are modelled in code (`client/src/three/models.js`). The fonts are Orbitron and Space Grotesk, from Fontsource under the SIL Open Font License.
