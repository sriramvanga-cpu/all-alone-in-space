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

```bash
cd server
npm start
```

The server listens on `0.0.0.0:8787`.

## VITE_API_URL

Scores post to `VITE_API_URL`. `npm run dev` defaults to `http://127.0.0.1:8787`. A production build with no `VITE_API_URL` skips the network, keeps scores in localStorage, and stays playable. The live leaderboard still needs this server hosted somewhere public.

Set the host LAN address when you start Vite:

```bash
cd client
VITE_API_URL=http://192.168.1.20:8787 npm run dev
```

Use the host machine's LAN IP in place of `192.168.1.20`.

## Other laptops

Point them at the host machine's LAN IP.

- API: `http://<host-lan-ip>:8787`
- Game: `http://<host-lan-ip>:5173`
- Display board: `http://<host-lan-ip>:5173/board`
