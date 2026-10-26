# Chrome Web Store listing — Clockwise

Everything to paste into the Chrome Web Store developer dashboard (https://chrome.google.com/webstore/devconsole).
Upload `dist/clockwise-<version>.zip` (made by `node scripts/pack.mjs`).

## Store listing tab

**Name** (from the manifest): Clockwise

**Summary** (132 characters max):
> Records your Blood on the Clocktower games on botc.app and shares them with your community's stats dashboard.

(The summary comes from the extension's manifest, so it's filled in automatically.)

**Description:**
> Clockwise keeps statistics for a group of friends who play Blood on the Clocktower on botc.app.
>
> While you play, storytell or watch on botc.app, Clockwise records each game automatically when the grimoire is revealed: the script, who won, every player's character and alignment, deaths, nominations and votes, and the storyteller's reminder tokens. Games go to your community's shared stats, so everyone sees the same dashboard. If several people record the same game it's only counted once.
>
> The dashboard shows:
> • win rates for good and evil, by script, player count and storyteller
> • each player's record, best and worst characters, teammates and rivals
> • how each character and character type does, and which characters tip games towards good or evil
> • every game's grimoire, drawn the way botc.app reveals it
>
> You sign in once (or create an account with your community's password) and stay signed in, in the extension and on the dashboard website. From the extension's menu you choose which community a game goes to, or that it shouldn't be recorded at all.
>
> Your account can also:
> • claim your player, so you're first in the player list (Clockwise fills it in from your botc.app account)
> • keep your stats private: only you can see your player page
> • make your own communities from the rooms you play in, to filter by
>
> The dashboard is only for your community: it needs an account. Clockwise isn't made by or connected with botc.app or The Pandemonium Institute.

**Category:** Lifestyle → Games (if not offered, use "Entertainment").

**Language:** English

**Screenshots** (1280×800): `store/screenshots/1-overview.png`, `2-player.png`, `3-grimoire.png`, `4-character-type.png`.

**Icon:** taken from the zip (`icons/icon-128.png`).

## Privacy tab

**Single purpose:**
> Records Blood on the Clocktower games played on botc.app and shows them as statistics for the user's community.

**Permission justifications:**
- `storage` — keeps recorded games and settings in the browser until they're uploaded.
- `unlimitedStorage` — a community's game history and the downloaded copy of shared games can exceed the default storage limit.
- `alarms` — retries uploading games every 30 minutes if an upload failed (for example when offline).
- `scripting` — connects to botc.app tabs that were already open when the extension was installed or updated, so they don't need reloading.
- Host permission `https://botc.app/*` — reads the game state on botc.app to record games, and botc.app's public character images and fonts for drawing tokens.
- Host permissions `https://script.google.com/*`, `https://script.googleusercontent.com/*` — uploads games to, and reads them from, the community's shared Google Apps Script store.
- Content script on `https://myclockwise.com/*` (new in 3.1) — the extension's own community dashboard website. It only keeps the user's Clockwise sign-in the same in the extension and on that site, so they sign in once; it reads nothing else there.

**Remote code:** No, I am not using remote code.

**Data usage — what the extension collects:**
- ☑ Personally identifiable information (botc.app usernames and account IDs of players in recorded games)
- ☑ Authentication information (the Clockwise username and password the user signs in with; the password is sent only to the community's store, which keeps it salted and hashed)
- ☑ Website content (the game state shown on botc.app: characters, votes, deaths, reminder tokens)
- Everything else: unchecked.

**Certify:** ☑ not sold to third parties · ☑ not used or transferred for purposes unrelated to the single purpose ·
☑ not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** `https://myclockwise.com/privacy.html`

## Version 3.1 — what changed (for your notes; the store doesn't ask)

- Sign in once (or create an account) in the popup; the sign-in is shared with the dashboard website.
- "Open dashboard" opens the community website; the extension no longer has its own dashboard.
- One community dropdown, including your own communities and "Don't record".
- Reminder tokens come only from the storyteller's grimoire.
- Your player is claimed automatically from your botc.app account.

## Distribution tab

**Visibility:** Unlisted — only people with the link can find and install it. (Anyone who installs it uploads games to
your Sheet, so share the link only with your community.)

**Regions:** All regions.
