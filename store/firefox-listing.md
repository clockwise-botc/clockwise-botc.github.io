# Firefox Add-ons listing — Clockwise

Everything to fill in on Firefox Add-ons (https://addons.mozilla.org/developers/). Submitting is free; you need a
Mozilla account. Upload `dist/clockwise-<version>-firefox.zip` (made by `node scripts/pack.mjs --firefox`).

The Firefox package is the same extension as the Chrome one, with a Firefox manifest: the background runs as an event
page instead of a service worker, the add-on id is `clockwise@myclockwise.com` (keep it: Firefox matches updates by it),
it needs Firefox 140 or later, and it declares the data it sends (Firefox shows this when someone installs it).

## Submit a New Add-on

**Where to distribute:** "On this site" (listed on addons.mozilla.org, updates install automatically). Anyone can
find it there, but it records nothing until someone signs in, and accounts can only be made with your community's
password. "On your own" would get you a signed file to hand out yourself instead, but Firefox wouldn't update it
automatically.

**Compatibility:** Firefox only. Leave Firefox for Android unchecked (not tested there).

**Source code:** "Do you use any of the following in your extension: code generators, minifiers, bundlers…?" → No.
The files in the zip are the source.

## Describe Add-on

**Name:** Clockwise

**Add-on URL:** `clockwise` (if taken: `clockwise-botc`)

**Summary** (250 characters max):
> Records your Blood on the Clocktower games on botc.app and shares them with your community's stats dashboard.

**Description:** the same as the Chrome listing (`store/listing.md`, "Description").

**Categories:** Games & Entertainment

**Support website:** `https://myclockwise.com/` · **Support email:** your choice

**License:** your choice. "All Rights Reserved" keeps things as they are.

**Privacy policy:** Firefox Add-ons wants the text itself, so paste the text of `https://myclockwise.com/privacy.html`.

**Screenshots:** `store/screenshots/1-overview.png`, `2-player.png`, `3-grimoire.png`, `4-character-type.png`.

## Data collection (already in the manifest)

Firefox shows these at install, from `browser_specific_settings.gecko.data_collection_permissions`:
- Personally identifying information: botc.app usernames and account IDs of players in recorded games
- Authentication information: the Clockwise username and password the user signs in with (sent only to the
  community's store, which keeps it salted and hashed)
- Website content: the game state shown on botc.app (characters, votes, deaths, reminder tokens)

## Notes to reviewer

> Clockwise records Blood on the Clocktower games played on https://botc.app and uploads them to the community's
> shared store (a Google Apps Script web app). Nothing is recorded until the user signs in to a Clockwise account in
> the popup; accounts can only be created with the community's password, so the store only holds that community's
> games. A content script on https://myclockwise.com (the community's dashboard website) only keeps the sign-in the
> same in the extension and on that site. page-hook.js runs in botc.app's page world to read its game state; it
> never changes it. No remote code is loaded.

If the reviewer asks for a way to sign in, make them a separate account (not your own) and give them its username
and password in the reviewer notes.
