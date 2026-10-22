# Clockwise

A Chrome extension that automatically records every Blood on the Clocktower game you play on [botc.app](https://botc.app). It saves who won, every player's character and alignment, travellers, deaths, nominations and votes. Each game is tagged with a community (e.g. Escape or Rhap). A built-in dashboard shows win rates by community, character, player, script, player count and storyteller. You can export everything as CSV, or sync it to a Google Sheet to build your own dashboards.

## Install (2 minutes)

1. Open `chrome://extensions` in Chrome. Edge, Brave and Arc work too.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder.
4. Pin the extension (puzzle-piece icon → pin **Clockwise**).

**Updating:** after the files change, click the circular reload arrow on the Clockwise card in `chrome://extensions`. Refreshing the dashboard alone isn't enough, because Chrome keeps running the old background part (which records games and fetches botc.app's art). The dashboard shows a banner when that's the case. botc.app tabs that are already open reconnect automatically.

That's it. Keep botc.app open while you play or spectate. When a game is running, the toolbar icon shows a red **REC** badge. The game is saved when the storyteller ends it (reveals the grimoire). Click the icon → **Open dashboard** to see your stats.

Only games you're present for are recorded. When you join a room, botc.app sends the room's last game even if it finished before you arrived; the extension ignores it. If you join part-way through a game, it's recorded from that point on. Deaths and nominations from before you arrived are missing, but the final characters and winner are complete.

## Communities

Each game can be tagged with a community (Escape or Rhap), so you can see each group's stats separately:

- A game in the room **`escape`** (`https://botc.app/#escape`) is tagged **Escape** by default.
- A game in **any other room** is tagged **Rhap** by default, since Rhap uses a new room each time.
- To change it, click the extension icon while you're in the room. The community that's on is highlighted: click the other one to switch, or click the highlighted one to switch it off. With neither on, games are still recorded, just without a community. The choice is remembered for that room and applies to the game being played, the game that just ended there (so you can fix it during the reveal), and later games. Earlier games keep their community. **Use automatic** goes back to the default.
- To fix a single past game, open it in the **Games** tab and click its community (click it again to switch it off).
- To add more communities, list extra rooms for one, or change the default for other rooms, use **Communities** in **Data & settings**.

> Works in the browser version of botc.app only, not the downloadable desktop app.

## What gets recorded

| Per game | Per player | Per nomination |
|---|---|---|
| Date, duration, room, community | Seat, username, account ID | Day |
| Script | Final character and team | Nominator and nominee |
| Winner (good/evil) | Starting character (when you're the storyteller) | Votes, majority needed |
| Storyteller(s) | Alignment (incl. travellers, turned evil, etc.) | Who voted |
| Player and traveller counts | Survived, or which day/night they died | Completed or cancelled |
| Number of days, Fabled, demon bluffs | Reminder tokens on them, dead vote used | |
| | Won or lost | |

The character, alignment and winner data comes from the end-of-game reveal, which botc.app sends to everyone in the room. So it works whether you're a player, the storyteller or a spectator. Nominations and deaths are recorded live, so keep the tab open for the whole game.

## Dashboard

The look follows the Mayor-Baron Type Indicator: warm parchment, cream cards with large rounded corners, and plum text, with Fraunces titles and Figtree text (both bundled, so it works offline). Good is shown in its Townsfolk blue and evil in its Minion rust. Tabs sit in a pill bar at the top right, and the filters sit in one row in the same pill style. Once you set a filter, a short summary of what you are looking at appears above the row of cards, with the most interesting card highlighted in mauve. It fills the window up to 1440px wide and stays centered on bigger screens. It uses a dark theme by default, on a tiled purple texture that runs behind the header too. Click the Clockwise logo to go back to the main page.

The dashboard has three tabs: **Stats** (the default), **Games** and **Data & settings**.

### Stats

The Stats tab is a single page that adapts to what you select. With nothing selected (or just a community), it shows the overall picture:

- **Totals:** the number of games, the average game length, and a spotlight on the player with the highest win rate. Only players with at least 5 games (or 10% of all games) count. It's a single highlight, not a ranking, so nobody is singled out for a low win rate.
- **Game balance:** a pie chart of good vs. evil wins, with a one-line verdict such as "Games look balanced between both teams."
- **Player count:** a pie chart of how many players sat down. Lighter slices mean smaller tables, and every size is listed underneath with its number of games.
- **Most frequent players** and **most frequent storytellers:** the top 5 of each, by number of games.
- **Who wins:** by script, by player count, and by storyteller.
- **Characters:** the characters that help good and those that help evil.
- **With a storyteller picked** (the storyteller filter), the two storyteller cards are swapped for **How their games compare** (good win rate, game length, deaths and nominations per game, next to other storytellers' games under the same filters) and **Their favourite characters**. That card shows the characters they put in play more often than other storytellers do, compared on the same scripts so it reflects their choices rather than which scripts they run.

**Players**, **Characters** and **Character type** are dropdowns. Type to search, and tick as many as you like (the list stays open while you pick). **Selected (N)** shows only what you've ticked, and **All** clears the selection. When closed, the dropdown shows your pick ("wren", or "wren +1" for more). Excluded games are left out of the stats but still listed, dimmed, on the Games tab, so you can find and un-exclude them.

Pick anything to focus the page on it. Every name on the page is clickable and adds itself to the selection.

- **Players** (pick one or several). One player shows:
  - **At the top:** a win-rate chart with good (outer ring), evil (middle ring) and overall (center), with a one-line key per ring saying how many points above or below the average player it is. The average is every other player's results in the games in your filters; hover a line to see the counts behind it. Next to it, their most played, best performing and worst performing characters, shown as botc.app tokens. Best and worst only count characters played at least twice.
  - **Below:** how they do by character type (all five, including Traveller), and the characters they've played (most played first). Then the teammates they win most with and the opponents they struggle against (as two separate cards), how often their nominations and votes land on evil players, and their results by script.
  - **Several players** shows each player's win-rate rings side by side (for the games they all played). Then **On the same team** (their win rate together overall, as good and as evil), and either **On opposite teams** (two players: the head-to-head score, e.g. wren 6 – 4 ash) or **When split up** plus a **Pair by pair** table (three or more).
- **Characters** (one or several): one character shows the holder's win rate, how good does when it's in play, when the holder tends to die, who plays it, and which other characters shift the result alongside it. Several characters shows how games go when they're all in play, compared with each on its own. If they've never all been in a game together (or only in fewer than 5), the page **predicts** the result instead. It learns from every game in your filters how much each character tends to shift the result, accounting for which characters usually appear together, and pulls characters with few games toward "no effect". It shows good vs. evil, a likely range covering about 80% of outcomes, each character's estimated shift, and its track record on your past games. If your games don't yet show character effects clearly enough to beat simply guessing the overall rate, it says so.
- **Character type** (Townsfolk, Outsider, Minion, Demon, Traveller): how many are in a typical game, its holders' win rate and survival next to all players, when they tend to die, each character of that type, which of them most help good and most help evil (like the overall page, but only that type), the best players at it, and how the result changes with how many are in play.
- **Combinations**:
  - A player plus a character shows that player's games **as** that character, e.g. *ash as the Imp* (held at the start or by the end). The page shows their win rate as it next to other players who held it, their results when another player had it, and all their games. It also shows when they tend to die as it, their nominations and votes, and their win rate against (or alongside) each Demon. With several characters it means any of them (*ash as the Imp or the Spy*), and with several players, games where each of them held one.
  - A player plus a type works the same way, e.g. *ash as a Demon*: their win rate as that type next to other players as that type, their games as any other type and all their games. It also shows when they tend to die, which characters of that type they've played, their nominations and votes, and their win rate against (or alongside) each Demon. If they were the Demon, it shows their win rate on each script instead.
  - A character plus a type shows that type in games with the character, e.g. *Outsiders when the Baron is in play*.

Every table can be sorted: click a column label to sort by it (▼), click it again to flip the order (▲), or click another column to sort by that instead. The **Community** buttons at the top start with neither on, which shows every recorded game. Turn on Escape, Rhap or both to see only those games. The dashboard remembers your choice. The script, storyteller and period filters narrow everything too. **See these games →** at the bottom jumps to the matching games. The tab and selection are saved in the page address, so you can bookmark a view.

### Games

The full list of games, using the same filters and selection. Click a game to see its **grimoire**, drawn like the botc.app reveal:

- Who sat in each seat, with their character token drawn the way botc.app draws it: the edition's parchment, the character art (red for a good character that turned evil), the name in capitals curving round the bottom in botc.app's own font, and the leaves for first night, other nights, reminders and setup. Dead players get botc.app's shroud, plus the skull if they used their dead vote. The token art and fonts are loaded from botc.app; **Data & settings** shows whether they've loaded, with a button to reload them. The leaves appear once you've opened botc.app with the extension running, since that's when it reads the character list.
- The storyteller's **reminder tokens** next to each player, as botc.app's purple discs with the reminder curving round the bottom (No Dashii *Poisoned*, Fortune Teller *Red herring*, Cerenovus *Mad*, Sweetheart *Drunk*, custom notes, and so on).
- Who won in the middle, exactly as botc.app announces it at the reveal ("GOOD / HAS WON!" in blue, "EVIL / HAS WON!" in orange-red, in its Sorts Mill Goudy font), plus the Fabled and the demon bluffs in the corners.

The images are botc.app's own: the background theme the storyteller chose (or the custom background shown), the character tokens (in good or evil colors to match each player's alignment), and the reminder token icons. They load from botc.app when you view a game; nothing is copied into the extension. The extension keeps a list of botc.app's image files and refreshes it by itself (no botc.app tab needed), so older games keep their images after botc.app updates. If a botc.app image can't be loaded, the character's icon from the official wiki (wiki.bloodontheclocktower.com) is used instead. If neither loads, the token shows its name on a plain disc.

Hover over a token for its details, or click a name to see that player or character on the Stats tab. Below the grimoire, switch between **Seat by seat** (each player's character, alignment, fate, reminders and result, where you can also fill in a missing name) and **Nominations** (who nominated whom, the votes and who voted). The **•••** button swaps the table for the game's settings: its community and storyteller, notes, excluding it from stats, and deleting it. Click ••• again, or a tab, to go back.

Reminder tokens and demon bluffs are recorded from the end of the game through the storyteller's reveal. If the storyteller never reveals the grimoire, players won't receive them (the storyteller's own tracker always has them).

### Data & settings

This tab has CSV/JSON export (of the games matching your current filters), import, **Shared games** (the community password, an editor key, and upload/download status), communities, and deleting the games kept in this browser. On the website it has export, the editor key, and **Sign out**.

## Building your own dashboards

**CSV export.** **Data & settings** exports four tidy tables with one row per item. Each table has a `community` column for filtering:

- `games.csv`: one row per game
- `game_players.csv`: one row per player per game. This is usually the one you want for pivot tables like win rate by character or player.
- `nominations.csv`: one row per nomination
- `deaths.csv`: one row per death

**The shared Google Sheet.** When sharing is set up (below), the Sheet that stores everyone's games also keeps the same four tables as tabs (`games`, `game_players`, `nominations`, `deaths`), updated as games arrive. You can point Looker Studio, Sheets charts or pivot tables at them.

## Sharing with your community

Clockwise can send every recorded game to one shared place, so everyone sees the same stats, including people without the extension.

- **Recording:** everyone in the community installs the extension. Each game they're in is uploaded when the grimoire is revealed. Several people can record the same game: a game's ID is its room plus the moment the storyteller started it, which is the same for everyone in the room, so it's stored once. If the recordings differ (say one person joined late), the more complete one is kept and gaps are filled from the other.
- **Viewing:** the community dashboard website shows everyone's games after the **community password**. The extension's own dashboard shows the same once you enter the password there (until then it shows only the games recorded in your browser).
- **Fixing and deleting:** changing a game's community, storyteller, notes or player names, excluding it, or deleting it changes it for everyone, so it needs an **editor key**. Deleted games aren't accepted again if someone uploads them later.
- **Keys:** the store has three keys, kept in the Apps Script's *Script properties* so they can be changed any time: the community password (`VIEW_PASSWORD`), the upload key built into the extension (`WRITE_KEY`, which can only upload), and the editor key (`EDITOR_KEY`).

### Setting up the shared store (once, by the organiser)

1. Create a Google Sheet → **Extensions → Apps Script**. Replace everything in `Code.gs` with `google-sheets/Code.gs` from this folder, and save.
2. **Project Settings** (gear icon) → **Script properties** → add `VIEW_PASSWORD`, `WRITE_KEY` and `EDITOR_KEY`.
3. **Deploy → New deployment** → type **Web app**. Execute as **Me**, who has access **Anyone**. Authorize when asked, then copy the web app URL (ends in `/exec`). Opening it in a browser should show `"service":"clockwise","ready":true`.
4. In `extension/src/config.js`, set `BACKEND_URL` to that URL, `WRITE_KEY` to the same upload key, and `SITE_URL` to the dashboard website's address.
5. Build the website (`node scripts/build-web.mjs`, which writes `docs/`) and publish it with GitHub Pages (repository **Settings → Pages → Deploy from branch → main / docs**).
6. Package the extension (`node scripts/pack.mjs`, which writes `dist/clockwise-<version>.zip`) and submit it to the Chrome Web Store as **Unlisted**, using `store/listing.md`.

**Updating the store later:** rebuild with `node scripts/build-backend.mjs`, paste the new `google-sheets/Code.gs` into Apps Script, then **Deploy → Manage deployments → edit → Version: New version** (this keeps the same URL).

**Testing locally:** `node backend/test.mjs` runs the store's tests, and `node backend/local.mjs` starts a stand-in store at `http://localhost:8787/exec` (password `view-pass`, upload key `write-key`, editor key `editor-key`). Point the extension at it under **Data & settings → Shared games → Advanced**, or build the website against it with `node scripts/build-web.mjs --backend http://localhost:8787/exec`.

## Good to know

- **Renamed players:** people often change their botc.app name (sometimes as a joke for one game). Their account stays the same, so their games are always counted together. Everywhere in the stats they're shown under the name they've used most, as a player or storyteller, ignoring names made only of invisible characters. A game's grimoire still shows the name they used in that game.
- **Where data lives:** games are kept in your browser's extension storage and, when sharing is set up, uploaded to your community's shared Google Sheet. Removing the extension deletes the copy in your browser, so export a JSON backup first if sharing isn't set up.
- **Starting characters** (e.g. before a Snake Charmer or Pit-Hag swap) are only fully known to the storyteller. As a player, you only get your own starting character.
- **Hidden votes** (e.g. Organ Grinder) are recorded as "hidden".
- If the storyteller cancels the reveal and keeps playing, the half-saved game is discarded and saved again at the real end.
- The extension reads botc.app's in-page game state; it never sends anything to botc.app or changes the game. Click the toolbar icon any time to check the connection. If it says the game data couldn't be read, a botc.app update has probably changed how the page works.

## Files

```
extension/
  manifest.json
  src/page-hook.js     reads game state inside the botc.app page
  src/bridge.js        relays saved games to the extension
  src/background.js    storage, uploading games, fetching botc.app's art
  src/config.js        the shared store's address and upload key (set by the organiser)
  src/shared.js        talking to the shared store
  src/data.js          where the dashboard's games come from (this browser, the shared store, or both)
  src/communities.js   which community a room/game belongs to
  src/stats.js         filters and overall win-rate calculations
  src/insights.js      stats for any selection of players / characters / types, and the prediction model
  src/ui.js            shared HTML helpers
  src/dataview.js      Data & settings page
  src/tables.js        CSV / Sheets table layout
  src/dashboard.js     the dashboard (Stats and Games tabs), in the extension and on the website
  src/multiselect.js   the searchable checkbox dropdowns
  src/grimoire.js      the grimoire drawing for a game
  src/tokens.js        character and reminder tokens, drawn like botc.app's
  src/images.js        finds botc.app's images for characters, reminders and backgrounds
  fonts/               Fraunces, Figtree, Sorts Mill Goudy, Uncial Antiqua (SIL Open Font License)
  images/              the tiled page background
  dashboard.html/.css, popup.html, src/popup.js, icons/
backend/               the shared store's code (server.js, sheets-store.js, main.js), tests, and a local stand-in
google-sheets/Code.gs  the shared store, built from backend/ — paste into Apps Script
scripts/               build-backend.mjs, build-web.mjs (website → docs/), pack.mjs (Web Store zip)
site/privacy.html      privacy policy (published with the website)
store/                 Chrome Web Store listing text and screenshots
docs/                  the built website (GitHub Pages)
```
