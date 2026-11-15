# Running the fest

A guide for whoever sets up and runs the Nova Grid booth.

You need two things:

- **Player devices** open the game: <https://client-ten-phi-98.vercel.app>
- **The display screen** shows the leaderboard: <https://client-ten-phi-98.vercel.app/board>

A run takes at most 15 minutes of play, plus about a minute for registration, the intro film and How to play (both can be skipped).

## Before the fest

1. **Check the live version** is the one you want. See [Deploying](how-it-works.md#deploying) if it needs updating.
2. **Open the board** and check that it says **Live** in the top corner. If it says **Offline**, see [Troubleshooting](#troubleshooting).
3. **Test with admin mode.** Enter `admin` as both name and phone. An admin run never reaches the board, and its admin panel can jump to any part of the game. See [Admin mode](admin-mode.md).
4. **Don't play test runs with a real name.** Any finished run that isn't an admin run goes onto the live board, and the game has no way to delete it. If one slips through, see [Removing a test score](#removing-a-test-score).
5. **Check the sound** on each player device. Browsers only allow sound after the first tap, and the Launch button counts.

## Setting up

### Player devices

- Any laptop, tablet or phone with an up-to-date browser works. A laptop with a keyboard and mouse is easiest for the fuel games.
- The 3D intro film and the realistic planets need WebGL. Without it, the game switches to a 2D film and flat map art on its own, and plays the same.
- On desktop browsers, pressing Launch on the registration screen also switches the page to fullscreen.

### The display screen

- Open `/board` and make it fullscreen (F11 on most laptops).
- Keep the board's tab in front. Browsers slow down background tabs, so a hidden board updates late.
- The board checks for new scores every 3 seconds. It shows the top three on a podium and the rest of the top 10 in a table. A run that joins the top 10 while the board is open plays an entrance: a table row slides in glowing, a podium card drops in with a ring pulsing out (gold for a new leader), and both wear a **New** tag for about 8 seconds. The runs already there when the board opens don't play it. Before anyone has finished a run, it shows an invitation to play instead. A **Playing now** column beside the scores (under them on a narrow screen) lists the pilots mid-run with their time left, worlds and fuel. It updates every 3 seconds, and a pilot drops off about 20 seconds after their device stops reporting.

## During the fest

### Each player

1. Registration: name and phone number. The phone number is stored for contacting prize winners and never shown on the board.
2. The intro film and How to play. Players can skip both. Pressing "Start the clock" (or Skip) on How to play starts their 15 minutes.
3. The run. First-time tips explain each part as it appears, and the clock waits while a tip is open.
4. The end screen shows their result, stats and rank, even if they're outside the top 10.
5. Press **Next pilot** to reset the device for the next player.

[Playing Nova Grid](playing.md) has everything a player needs to know, if you're explaining the game at the booth.

### When a run is saved

A run is saved only when it ends: a landing that settles, the clock running out, or the player getting stranded. A run abandoned partway through isn't saved. If someone tries to close or reload the page mid-run, the browser asks first.

The end screen says whether the score reached the board:

- **"Score is on the board."** Done.
- **"Couldn't reach the board. Your score is saved here and will send itself."** The score is queued in that browser and retried every few seconds, including after a reload. Keep using the same browser on that device, and don't clear its data, until the score appears on the board. A score is never saved twice, however many times it's retried.

## Troubleshooting

| What you see | What to do |
|---|---|
| The board says **Offline**, or "Can't reach the leaderboard. Retrying." | The board can't reach the scores database. It keeps the last scores on screen and retries every 3 seconds by itself. Check the internet connection. The first request after a quiet spell can take a few seconds while the database wakes up. |
| **Playing now** is empty, or a pilot is missing | It lists only real runs, so an admin run never shows. Each player's device reports every 5 seconds, so a pilot appears a few seconds after the run's clock starts and disappears about 20 seconds after their tab closes or loses its connection. The scores on the board aren't affected. |
| An end screen says "Couldn't reach the board" | The score is queued on that device and sends itself once the connection is back. Keep that browser open, or at least don't clear its data. |
| "Preparing launch…" stays on screen | The 3D film is loading its textures. After 9 seconds it switches to the 2D film by itself. **Skip** works at any time. |
| The maps show flat drawings instead of realistic planets | WebGL is off or still rendering the art. The game is fully playable as it is. |
| No sound | Check the **Sound** button (bottom right) and the device volume. Sound starts after the first tap. |
| A player wants to start over | Reload the page and confirm. The unfinished run isn't saved. |
| A test score is on the board | See [Removing a test score](#removing-a-test-score). |

## Results and prize winners

Scores live in Neon Postgres, on the `production` branch of the project. To list the top 20 with phone numbers, run this in the Neon console's SQL editor on that branch. It sorts the same way as the board:

```sql
SELECT name, phone, settled, fuel, time_left, worlds, finished_at,
  CASE WHEN settled THEN ROUND((fuel / 2.0 + time_left / 6.0)::numeric, 2) END AS points
FROM scores
ORDER BY settled DESC,
  CASE WHEN settled THEN ROUND((fuel / 2.0 + time_left / 6.0)::numeric, 2) ELSE 0 END DESC,
  worlds DESC, fuel DESC,
  CASE WHEN settled THEN time_left ELSE -time_left END DESC,
  id ASC
LIMIT 20;
```

`time_left` is in seconds.

### Removing a test score

The game itself can't delete scores. In the Neon console, on the `production` branch, find the row first:

```sql
SELECT id, name, finished_at, settled, fuel, time_left FROM scores ORDER BY finished_at DESC LIMIT 20;
```

Then delete it by its `id` (for example, 42):

```sql
DELETE FROM scores WHERE id = 42;
```

Deleting is permanent, and this is the live board, so check the `id` twice.
