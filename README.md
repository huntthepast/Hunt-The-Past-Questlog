# QuestLog

Hunt the Past's game journal: a public, fully static website (Astro + Tailwind CSS v4 + Alpine.js) that tracks

- the games I own and have played (library),
- the games I want to play (wishlist),
- my all-time favorites,
- my RetroAchievements profile, unlocks, masteries and per-game achievement progress,
- where every game stands: playing, on hold, played, beaten, completed, mastered, dropped,
- my own walkthroughs, cheat lists, tips, reviews, notes and missable / collectible trackers.

The public site has **no backend**. Everything it shows is read at build time from JSON and Markdown files in this
repository, so it deploys to Vercel as plain static files.

Editing happens through a **local-only admin** (`npm run admin`) that runs on your own computer, writes those files for
you, syncs RetroAchievements, and can commit + push when you are ready. It binds to `127.0.0.1`, is never deployed,
and is the only place the RetroAchievements API key is ever used.

```
 you  ──>  local admin (127.0.0.1:3333)  ──writes──>  src/content/*, src/data/*  ──git push──>  GitHub  ──>  Vercel (astro build)
                      │
                      └── RetroAchievements API (key stays in .env on your machine)
```

## Quick start

```bash
npm install
cp .env.example .env      # optional: fill in RA_USERNAME / RA_API_KEY for RetroAchievements
npm run dev               # public site with live reload  -> http://localhost:4321
npm run admin             # local admin                   -> http://127.0.0.1:3333
```

Requires Node 22.12 or newer.

| Script              | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | Astro dev server for the public site                                         |
| `npm run build`     | Production build into `dist/` (this is all Vercel runs)                      |
| `npm run preview`   | Serve the production build locally                                           |
| `npm run check`     | Type-check the Astro/TypeScript code                                         |
| `npm run admin`     | Compile the admin stylesheet and start the local admin server (auto-restarts when its code changes) |
| `npm run admin:css` | Only rebuild the admin stylesheet (Tailwind CLI)                             |

## Daily workflow

1. `npm run admin` and open <http://127.0.0.1:3333>.
2. Add or edit games, guides and trackers. Every save writes straight into the repo (see "Where the data lives").
3. Optionally open **RetroAchievements → Sync now** to refresh your profile snapshot and achievement lists.
4. Run `npm run dev` in another terminal if you want to preview at <http://localhost:4321>.
5. Go to **Publish**: optionally run the test build, then **Commit all & push**. Vercel rebuilds automatically.
   (Or just `git add -A && git commit -m "..." && git push` yourself.)

## Where the data lives

```
src/content/games/<slug>.json      one file per game (library and wishlist)
src/content/guides/<slug>.md       markdown guides with YAML frontmatter
public/guides/<slug>/              images (maps etc.) uploaded through the admin for that guide
src/content/trackers/<slug>.json   checklists (missables, collectibles, bosses, ...)
src/content/ra-games/<id>.json     RetroAchievements per-game snapshots (written by the admin sync)
src/data/site.json                 site title, tagline, owner, about text, footer links
src/data/platforms.json            platform list (+ RetroAchievements console ids for auto-matching)
src/data/ra-profile.json           RetroAchievements profile snapshot (written by the admin sync)
src/data/shelf.json                manual trophy-shelf order / hidden badges (empty = follow RA)
public/covers/                     cover images uploaded through the admin
```

You can also edit these files by hand; the schemas in `src/content.config.ts` validate them at build time.

### Game

(The `//` comments below are only for illustration; real JSON files cannot contain them.)

```json
{
  "title": "Chrono Trigger",
  "platform": "snes",
  "cover": "/covers/chrono-trigger.jpg",
  "genres": ["RPG"],
  "developer": "Square",
  "publisher": "Square",
  "releaseYear": 1995,
  "ownership": "owned",          // owned | wishlist
  "favorite": true,
  "status": "beaten",            // unplayed | playing | on-hold | played | beaten | completed | mastered | dropped
  "rating": 10,                  // 0-10
  "hoursPlayed": 28,
  "startedAt": "2026-06-02",
  "finishedAt": "2026-07-14",
  "raGameId": 1234,              // retroachievements.org/game/1234 - enables achievement sync
  "review": "Markdown allowed.",
  "notes": "Where I left off...",
  "tags": ["classic"],
  "addedAt": "2026-09-18T12:00:00.000Z",
  "updatedAt": "2026-09-18T12:00:00.000Z"
}
```

Statuses, guide types and tracker types are defined once in `src/lib/constants.js` and shared by the site and the admin.

### Guide

Markdown (GitHub-flavored: tables, task lists, footnotes) with frontmatter:

```md
---
title: "Chrono Trigger - Maps"
type: "Maps"                 # free text: Walkthrough, Maps, Items, Persona List... guides of a game are grouped by it
game: "chrono-trigger"      # optional link to a game slug
summary: "Every area map in one place."
version: "1.0"              # optional, GameFAQs-style
order: 1                    # position inside its type group (lower first)
tags: ["snes"]
draft: false
gallery:                    # optional image wall shown above the text, with a full-screen viewer
  - src: "/guides/chrono-trigger-maps/guardia-forest.png"
    title: "Guardia Forest"
    caption: "600 AD"
downloads:                  # optional buttons in the sidebar (e.g. a zip attached to a GitHub release)
  - label: "All maps (zip)"
    url: "https://github.com/<you>/<repo>/releases/download/v1/maps.zip"
createdAt: "2026-09-19T09:00:00.000Z"
updatedAt: "2026-09-19T09:00:00.000Z"
---

## Part 1: Guardia Forest

### Map
![Guardia Forest](/guides/chrono-trigger-maps/guardia-forest.png)

### Checklist
- [ ] Power Tab in the lower clearing

### Walkthrough
...
```

Every guide of a game is listed in a sidebar on each of that game's guide and tracker pages (grouped by type),
so a reader can jump from the walkthrough to the item list or the map gallery. Headings become the page's table
of contents; `- [ ]` task lists are tickable by readers (saved in their browser). Images uploaded through the
admin's **Images & gallery** panel land in `public/guides/<slug>/`; the **Template** button inserts the
walkthrough skeleton (intro, controls, characters, one map + checklist + walkthrough block per area, credits),
and **Link to guide** inserts links to another guide's sections. Clicking any image opens a lightbox.

### Tracker

```json
{
  "title": "Chrono Trigger - Missables",
  "type": "missables",      // missables | collectibles | sidequests | achievements | bosses | checklist
  "game": "chrono-trigger",
  "sections": [
    { "title": "1000 AD", "items": [ { "id": "power-tab", "label": "Power Tab - Guardia Forest", "note": "...", "done": true } ] }
  ],
  "createdAt": "...", "updatedAt": "..."
}
```

On the public site a tracker shows your progress, and visitors can switch to "My own progress" to tick items for
themselves (stored only in their browser's localStorage).

## RetroAchievements

1. Copy `.env.example` to `.env` and set `RA_USERNAME` and `RA_API_KEY`
   (retroachievements.org → Settings → Keys → *Web API Key*). `.env` is git-ignored.
2. Restart `npm run admin`, open the **RetroAchievements** tab and click **Sync now**.

A sync:

- writes your profile, rank, points, recent unlocks (last 60 days), per-game completion and awards to
  `src/data/ra-profile.json`;
- for every library game with a `raGameId`, writes the full achievement list with your unlock dates to
  `src/content/ra-games/<id>.json` (shown on that game's page, including missable / progression markers);
- fills in missing cover art, developer, publisher, genre and release year on those games (never overwrites what you typed);
- with **Update hours played** enabled (default), sets `hoursPlayed` from RA's tracked playtime for each linked game. RA only
  counts sessions played while the emulator was connected, so the sync only ever raises the number and never lowers hours
  you logged yourself;
- with **Auto-upgrade statuses** enabled, promotes games to Beaten / Completed / Mastered from your RA awards (never downgrades).

Other RA helpers in the admin:

- **Fetch** next to the RA game id in the game editor pre-fills title, platform, box art, developer, publisher, genre and year.
- **Find games to import** lists every game in your RA history that is not in the library yet and creates entries for the ones you pick.
- **Import RA console list** adds RA systems to `platforms.json` so imports map to the right platform automatically.
- **Trophy shelf** (bottom of the RetroAchievements tab) arranges the badge wall shown on the Achievements page. By default it
  mirrors your RA profile order (what you set with "Reorder Site Awards" on RA); drag rows, use the arrows or hide badges to
  arrange it by hand instead. Saved in `src/data/shelf.json`; "Follow RA order" clears it.

The public site only ever reads the JSON snapshots, so the API key never leaves your machine and the site keeps
working even if RetroAchievements is down.

## Deploying to Vercel

1. Push this repository to GitHub (it can be public: secrets live only in `.env`, which is ignored).
2. In Vercel, **Add New Project → Import** the repo. The Astro preset is detected automatically
   (build command `npm run build`, output directory `dist`). No environment variables are needed.
3. Every push to `main` triggers a new build. Set `site` in `astro.config.mjs` to your final URL so canonical and
   Open Graph tags are correct.

`admin/` is listed in `.vercelignore` and is never started by Vercel: the deployment is just the `dist/` folder.

## Security notes on the admin

- Listens on `127.0.0.1` only; requests with a foreign `Host` header are rejected (DNS-rebinding guard) and
  cross-site form posts are blocked (CSRF middleware). It is meant to be run on your own machine while you use it.
- Slugs are validated (`a-z`, `0-9`, `-`), uploads are limited to PNG/JPEG/WebP/GIF under 8 MB, and file paths are
  always resolved inside the repo.
- The API key is read from `.env` and never returned by any endpoint.

## Project layout

```
admin/                 local admin (Hono server + Alpine.js UI, Tailwind via CLI)
  server.js            routes: /api/games, /api/guides, /api/trackers, /api/ra/*, /api/git/*, /api/site, /api/platforms
  lib/                 store (file I/O), schemas (zod validation), ra (RetroAchievements client + sync), git, slug
  public/              admin UI (index.html, app.js) - styles.css is generated and git-ignored
src/
  alpine.ts            Alpine components used by the public site (list filtering, tracker "my progress" mode)
  content.config.ts    content collection schemas (games, guides, trackers, raGames)
  lib/                 constants.js (shared vocabulary), data.ts (queries/formatting), ui.ts (color maps)
  layouts/, components/, pages/, styles/global.css
```

## Customizing

- Colors and fonts: `src/styles/global.css` (`@theme` block) and the color maps in `src/lib/ui.ts`.
- Statuses / guide types / tracker types: `src/lib/constants.js` (used by both site and admin).
- Site texts and footer links: **Settings** in the admin (or `src/data/site.json`).
