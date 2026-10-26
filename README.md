# All Alone in Space

The game runs in `client/`. The leaderboard runs in `server/`.

## Game

```bash
cd client
npm test
npm run dev
```

`npm test` checks the rules. `npm run dev` starts Vite on port 5173.

Play at `/`. A display laptop opens `/board`, which polls the leaderboard every 3 seconds.

Starter cards live in `client/src/data/questions.json`. Replace them before the fest.

## Leaderboard

Scores are stored in the Neon Postgres branch linked by `neon.ts`. `neon deploy` writes `DATABASE_URL` into `.env.local`. Set that same variable on the Vercel project before a production deploy. The game posts to `/api/scores` on the same host. `/board` reads `/api/leaderboard`.

`server/` is the old SQLite board. The game does not call it.

## Image credits

Planet textures and the Milky Way panorama in `client/public/textures/` are from [Solar System Scope](https://www.solarsystemscope.com/textures/) (based on NASA mission data), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They were resized and the sky brightened for the game. The 3D ships and station are modelled in code (`client/src/three/models.js`).
