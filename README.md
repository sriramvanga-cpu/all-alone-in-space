# Nova Grid

A 15-minute space game for a college fest. Vulcan has broken apart, and the player captains the last starship with 15 minutes of air left. They fly from star to star, refuel by playing quick fuel games, answer a question at each world that could be home, and try to land on one before the clock runs out. A display board shows the best pilots live.

- **Play:** <https://client-ten-phi-98.vercel.app>
- **Leaderboard display:** <https://client-ten-phi-98.vercel.app/board>

## Documentation

| If you want to… | Read |
|---|---|
| Learn how to play, or explain it at the booth | [Playing Nova Grid](docs/playing.md) |
| Set up and run the booth, fix problems, collect results | [Running the fest](docs/running-the-fest.md) |
| Test any part of the game quickly | [Admin mode](docs/admin-mode.md) |
| Understand the code, the API and the database | [How it works](docs/how-it-works.md) |
| Change the questions, fuel games, events, rules or story | [Changing the content](docs/changing-content.md) |

## Quick start

You need Node.js 20.19+ or 22.12+, as Vite 8 requires.

```bash
cd client
npm install
npm test
npm run dev
```

`npm run dev` serves the game at <http://localhost:5173>, with the scores API alongside it. Locally, scores go to the `dev` branch of the Neon database (set in `.env.local` at the repo root), never to the fest board. To run with no database at all:

```bash
cd client
DATABASE_URL= npm run dev
```

For test runs that never reach the board, enter `admin` as both the name and the phone number: see [Admin mode](docs/admin-mode.md). To deploy, see [Deploying](docs/how-it-works.md#deploying).

## Credits

Planet textures and the Milky Way panorama in `client/public/textures/` are from [Solar System Scope](https://www.solarsystemscope.com/textures/) (based on NASA mission data), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They were resized and the sky brightened for the game. The 3D ships and station are modelled in code (`client/src/three/models.js`). The fonts are Orbitron and Space Grotesk, from Fontsource under the SIL Open Font License.
