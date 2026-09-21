import { RA_SITE, raImage, statusFromAwardKind, STATUS_IDS } from '../../src/lib/constants.js';
import { HttpError } from './errors.js';
import { slugify, uniqueSlug } from './slug.js';
import * as store from './store.js';

const API_BASE = `${RA_SITE}/API/`;
const USER_AGENT = 'huntthepast-questlog-admin/1.0 (+https://github.com/huntthepast)';
const REQUEST_GAP_MS = 350; // be polite to the RA API

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads credentials from the environment (loaded from .env by server.js). */
export function raConfig() {
  const username = (process.env.RA_USERNAME ?? '').trim();
  const apiKey = (process.env.RA_API_KEY ?? '').trim();
  return { username, apiKey, configured: Boolean(username && apiKey) };
}

export class RaClient {
  constructor({ username, apiKey }) {
    if (!username || !apiKey) throw new HttpError(400, 'RetroAchievements is not configured. Set RA_USERNAME and RA_API_KEY in .env and restart the admin.');
    this.username = username;
    this.apiKey = apiKey;
    this.lastCall = 0;
  }

  async call(endpoint, params = {}) {
    const wait = this.lastCall + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();

    const url = new URL(`${endpoint}.php`, API_BASE);
    url.searchParams.set('y', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'RetroAchievements rejected the API key. Check RA_API_KEY in .env.');
    if (res.status === 429) throw new HttpError(429, 'RetroAchievements rate limit hit. Wait a minute and try again.');
    if (!res.ok) throw new HttpError(502, `RetroAchievements ${endpoint} failed with HTTP ${res.status}`);
    return res.json();
  }

  getUserSummary({ recentGames = 10, recentAchievements = 0 } = {}) {
    return this.call('API_GetUserSummary', { u: this.username, g: recentGames, a: recentAchievements });
  }

  getUserProfile() {
    return this.call('API_GetUserProfile', { u: this.username });
  }

  getRecentAchievements(minutes) {
    return this.call('API_GetUserRecentAchievements', { u: this.username, m: minutes });
  }

  getUserAwards() {
    return this.call('API_GetUserAwards', { u: this.username });
  }

  async getCompletionProgress() {
    const pageSize = 500;
    const results = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await this.call('API_GetUserCompletionProgress', { u: this.username, c: pageSize, o: offset });
      const rows = page.Results ?? [];
      results.push(...rows);
      total = Number(page.Total ?? rows.length);
      offset += pageSize;
      if (rows.length < pageSize) break;
    }
    return results;
  }

  getGameInfoAndUserProgress(gameId) {
    return this.call('API_GetGameInfoAndUserProgress', { g: gameId, u: this.username, a: 1 });
  }

  getGame(gameId) {
    return this.call('API_GetGame', { i: gameId });
  }

  getConsoleIds() {
    return this.call('API_GetConsoleIDs', { a: 1, g: 1 });
  }
}

/* ---------------- normalisers ---------------- */

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pct = (v) => num(String(v ?? '').replace('%', ''));

/** RA hides prefixes like "~Hack~" in titles; keep the clean title and remember the flag as a tag. */
export function splitRaTitle(title) {
  const match = String(title ?? '').match(/^~([^~]+)~\s*(.+)$/);
  if (!match) return { title: String(title ?? '').trim(), tag: null };
  return { title: match[2].trim(), tag: slugify(match[1]) };
}

/** RA names subsets "Game [Subset - Name]" (older ones "~Bonus~ Game"). */
export const isSubsetTitle = (title) => /\[subset\b/i.test(String(title ?? '')) || /^~(bonus|subset)~/i.test(String(title ?? ''));

/** "Terraria [Subset - Completionist]" -> "Terraria" */
export const subsetParentTitle = (title) =>
  String(title ?? '')
    .replace(/\s*\[subset[^\]]*\]\s*/i, '')
    .replace(/^~(bonus|subset)~\s*/i, '')
    .trim();

export function releaseYearFrom(released) {
  const match = String(released ?? '').match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

/** Shapes API_GetGameInfoAndUserProgress into the file the site reads. */
export function normalizeGameProgress(raw, syncedAt) {
  const achievements = Object.values(raw.Achievements ?? {})
    .map((a) => ({
      id: num(a.ID),
      title: String(a.Title ?? ''),
      description: String(a.Description ?? ''),
      points: num(a.Points),
      trueRatio: num(a.TrueRatio),
      badge: raImage(`/Badge/${a.BadgeName}.png`),
      type: a.type ?? null,
      displayOrder: num(a.DisplayOrder),
      numAwarded: num(a.NumAwarded),
      numAwardedHardcore: num(a.NumAwardedHardcore),
      earnedAt: a.DateEarned ?? null,
      earnedHardcoreAt: a.DateEarnedHardcore ?? null,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);

  return {
    gameId: num(raw.ID),
    title: String(raw.Title ?? ''),
    // Subsets ("Game [Subset - Name]") point at their main game; the site shows them as tabs on that game's page.
    parentGameId: raw.ParentGameID != null && num(raw.ParentGameID) > 0 ? num(raw.ParentGameID) : null,
    consoleId: num(raw.ConsoleID),
    consoleName: String(raw.ConsoleName ?? ''),
    imageIcon: raImage(raw.ImageIcon),
    imageBoxArt: raImage(raw.ImageBoxArt),
    numAchievements: num(raw.NumAchievements),
    numAwarded: num(raw.NumAwardedToUser),
    numAwardedHardcore: num(raw.NumAwardedToUserHardcore),
    completion: pct(raw.UserCompletion),
    completionHardcore: pct(raw.UserCompletionHardcore),
    highestAwardKind: raw.HighestAwardKind ?? null,
    highestAwardDate: raw.HighestAwardDate ?? null,
    // RA's session tracking: total seconds the user spent in the game while connected to RA.
    playtimeSeconds: num(raw.UserTotalPlaytime),
    syncedAt,
    achievements,
  };
}

/**
 * RA has no "first played" date in its API; the earliest unlock in a set is the closest thing.
 * Returns YYYY-MM-DD or null when nothing is unlocked.
 */
export function firstUnlockDate(snapshot) {
  const dates = (snapshot.achievements ?? []).flatMap((a) => [a.earnedAt, a.earnedHardcoreAt]).filter(Boolean).map(String);
  return dates.length ? dates.sort()[0].slice(0, 10) : null;
}

const FINISH_AWARDS = new Set(['beaten-hardcore', 'beaten-softcore', 'completed', 'mastered']);

/** The date RA says the game was finished (beaten / completed / mastered award), YYYY-MM-DD, or null. */
export function finishDate(snapshot) {
  return snapshot.highestAwardDate && FINISH_AWARDS.has(snapshot.highestAwardKind) ? String(snapshot.highestAwardDate).slice(0, 10) : null;
}

/** RA playtime (seconds) -> hours with one decimal, e.g. 18720 -> 5.2 */
export const playtimeHours = (seconds) => Math.round((num(seconds) / 3600) * 10) / 10;

const DONE_RANK = { beaten: 1, completed: 2, mastered: 3 };

/** Only ever upgrades a status (played -> beaten -> completed -> mastered), never downgrades. */
export function upgradedStatus(current, awardKind, numAwarded) {
  const suggested = statusFromAwardKind(awardKind, numAwarded);
  const currentDone = DONE_RANK[current] ?? 0;
  const suggestedDone = DONE_RANK[suggested] ?? 0;
  if (suggestedDone > currentDone) return suggested;
  if (currentDone === 0 && suggestedDone === 0 && current === 'unplayed' && suggested === 'played') return 'played';
  return current;
}

/* ---------------- platform mapping ---------------- */

export function platformForConsole(platforms, consoleId, consoleName) {
  const byId = platforms.find((p) => p.raConsoleId === Number(consoleId));
  if (byId) return byId;
  const wanted = slugify(consoleName);
  return platforms.find((p) => p.id === wanted) ?? null;
}

/** Short labels for RetroAchievements system names (the ones shown on game cards). */
export const RA_SHORT_NAMES = {
  'mega drive': 'Genesis',
  'nintendo 64': 'N64',
  'snes/super famicom': 'SNES',
  'game boy': 'GB',
  'game boy advance': 'GBA',
  'game boy color': 'GBC',
  'nes/famicom': 'NES',
  'pc engine/turbografx-16': 'TG16',
  'sega cd': 'Sega CD',
  '32x': '32X',
  'master system': 'SMS',
  playstation: 'PS1',
  'atari lynx': 'Lynx',
  'neo geo pocket': 'NGP',
  'game gear': 'GG',
  gamecube: 'GCN',
  'atari jaguar': 'Jaguar',
  'nintendo ds': 'DS',
  wii: 'Wii',
  'wii u': 'Wii U',
  'playstation 2': 'PS2',
  xbox: 'Xbox',
  'magnavox odyssey 2': 'Odyssey 2',
  'pokemon mini': 'PokeMini',
  'atari 2600': '2600',
  dos: 'DOS',
  arcade: 'Arcade',
  'virtual boy': 'VB',
  msx: 'MSX',
  'commodore 64': 'C64',
  zx81: 'ZX81',
  oric: 'Oric',
  'sg-1000': 'SG-1000',
  'vic-20': 'VIC-20',
  amiga: 'Amiga',
  'atari st': 'Atari ST',
  'amstrad cpc': 'CPC',
  'apple ii': 'Apple II',
  saturn: 'Saturn',
  dreamcast: 'DC',
  'playstation portable': 'PSP',
  'philips cd-i': 'CD-i',
  '3do interactive multiplayer': '3DO',
  colecovision: 'Coleco',
  intellivision: 'INTV',
  vectrex: 'Vectrex',
  'pc-8000/8800': 'PC-88',
  'pc-9800': 'PC-98',
  'pc-fx': 'PC-FX',
  'atari 5200': '5200',
  'atari 7800': '7800',
  x68k: 'X68000',
  wonderswan: 'WS',
  'cassette vision': 'Cassette',
  'super cassette vision': 'Super CV',
  'neo geo cd': 'NGCD',
  'fairchild channel f': 'Channel F',
  'fm towns': 'FM Towns',
  'zx spectrum': 'Spectrum',
  'game & watch': 'G&W',
  'nokia n-gage': 'N-Gage',
  'nintendo 3ds': '3DS',
  'watara supervision': 'Supervision',
  'sharp x1': 'X1',
  'tic-80': 'TIC-80',
  'thomson to8': 'TO8',
  'pc-6000': 'PC-60',
  'sega pico': 'Pico',
  'mega duck': 'Mega Duck',
  zeebo: 'Zeebo',
  arduboy: 'Arduboy',
  'wasm-4': 'WASM-4',
  'arcadia 2001': 'Arcadia',
  'interton vc 4000': 'VC 4000',
  'elektor tv games computer': 'Elektor',
  'pc engine cd/turbografx-cd': 'TG-CD',
  'atari jaguar cd': 'Jaguar CD',
  'nintendo dsi': 'DSi',
  'ti-83': 'TI-83',
  uzebox: 'Uzebox',
  'famicom disk system': 'FDS',
  // RA files console-less games (Terraria, indie titles...) under "Standalone"; nearly all are PC games.
  standalone: 'PC',
};

export function shortNameFor(name) {
  const known = RA_SHORT_NAMES[String(name ?? '').trim().toLowerCase()];
  if (known) return known;
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9 /-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 10) return cleaned;
  const words = cleaned.split(' ');
  // Single long word: keep a readable prefix rather than a lone initial.
  if (words.length === 1) return cleaned.slice(0, 10);
  const initials = words.map((w) => (/^\d+$/.test(w) ? w : w[0].toUpperCase())).join('');
  return initials.length >= 2 ? initials.slice(0, 8) : cleaned.slice(0, 10);
}

/** Adds a platform for an RA console if none exists yet. Returns the (possibly new) platform. */
export async function ensurePlatform(consoleId, consoleName) {
  const platforms = await store.getPlatforms();
  const existing = platformForConsole(platforms, consoleId, consoleName);
  if (existing) {
    if (existing.raConsoleId == null && consoleId) {
      existing.raConsoleId = Number(consoleId);
      await store.savePlatforms(platforms);
    }
    return existing;
  }
  const platform = { id: slugify(consoleName) || `ra-${consoleId}`, name: consoleName, short: shortNameFor(consoleName), raConsoleId: Number(consoleId) };
  platforms.push(platform);
  await store.savePlatforms(platforms);
  return platform;
}

/* ---------------- sync job ---------------- */

const job = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  log: [],
  progress: { done: 0, total: 0 },
  summary: null,
};

export const syncStatus = () => ({ ...job, log: job.log.slice(-200) });

function log(message) {
  job.log.push({ at: new Date().toISOString(), message });
  console.log(`[ra] ${message}`);
}

/**
 * Full sync:
 *  1. profile + rank + recently played      -> src/data/ra-profile.json
 *  2. recent unlocks, completion, awards     -> src/data/ra-profile.json
 *  3. every library game with a raGameId     -> src/content/ra-games/<id>.json (+ enrich the game entry)
 */
export function startSync({ autoStatus = false, autoHours = true, autoDates = true } = {}) {
  if (job.running) throw new HttpError(409, 'A sync is already running');
  const { username, apiKey } = raConfig();
  const client = new RaClient({ username, apiKey });

  Object.assign(job, { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null, log: [], progress: { done: 0, total: 0 }, summary: null });

  (async () => {
    try {
      const syncedAt = new Date().toISOString();
      log(`Syncing RetroAchievements profile for ${username}...`);

      const summary = await client.getUserSummary({ recentGames: 10, recentAchievements: 0 });
      log(`Profile loaded: ${summary.TotalPoints ?? 0} points, rank ${summary.Rank ?? 'n/a'}.`);

      const recentRaw = await client.getRecentAchievements(60 * 24 * 60); // last 60 days
      const recentAchievements = (Array.isArray(recentRaw) ? recentRaw : [])
        .map((a) => ({
          date: a.Date,
          hardcore: num(a.HardcoreMode) === 1,
          id: num(a.AchievementID),
          title: String(a.Title ?? ''),
          description: String(a.Description ?? ''),
          points: num(a.Points),
          trueRatio: num(a.TrueRatio),
          badge: raImage(a.BadgeURL || `/Badge/${a.BadgeName}.png`),
          type: a.Type ?? null,
          gameId: num(a.GameID),
          gameTitle: String(a.GameTitle ?? ''),
          consoleName: String(a.ConsoleName ?? ''),
        }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 60);
      log(`${recentAchievements.length} unlocks in the last 60 days.`);

      const completionRaw = await client.getCompletionProgress();
      const completion = completionRaw.map((c) => ({
        gameId: num(c.GameID),
        title: String(c.Title ?? ''),
        consoleId: num(c.ConsoleID),
        consoleName: String(c.ConsoleName ?? ''),
        imageIcon: raImage(c.ImageIcon),
        maxPossible: num(c.MaxPossible),
        numAwarded: num(c.NumAwarded),
        numAwardedHardcore: num(c.NumAwardedHardcore),
        mostRecentAwardedDate: c.MostRecentAwardedDate ?? null,
        highestAwardKind: c.HighestAwardKind ?? null,
        highestAwardDate: c.HighestAwardDate ?? null,
      }));
      log(`${completion.length} games with progress.`);

      const awardsRaw = await client.getUserAwards();
      const awards = (awardsRaw.VisibleUserAwards ?? [])
        .filter((a) => a.AwardType === 'Mastery/Completion' || a.AwardType === 'Game Beaten')
        .map((a) => ({
          awardedAt: a.AwardedAt,
          type: a.AwardType,
          gameId: a.AwardData != null ? num(a.AwardData) : null,
          hardcore: num(a.AwardDataExtra) === 1,
          title: String(a.Title ?? ''),
          consoleName: String(a.ConsoleName ?? ''),
          imageIcon: raImage(a.ImageIcon),
          // Position from "Reorder Site Awards" on retroachievements.org (0 = never reordered).
          displayOrder: num(a.DisplayOrder),
        }))
        // Same order as the RA profile page: DisplayOrder, then the date the award was earned.
        .sort((a, b) => a.displayOrder - b.displayOrder || String(a.awardedAt).localeCompare(String(b.awardedAt)));
      log(`${awards.length} game awards (${awardsRaw.MasteryAwardsCount ?? 0} masteries).`);

      const awarded = summary.Awarded ?? {};
      const recentlyPlayed = (summary.RecentlyPlayed ?? []).map((g) => {
        const progress = awarded[g.GameID] ?? {};
        return {
          gameId: num(g.GameID),
          title: String(g.Title ?? ''),
          consoleName: String(g.ConsoleName ?? ''),
          imageIcon: raImage(g.ImageIcon),
          lastPlayed: g.LastPlayed,
          numPossible: num(progress.NumPossibleAchievements ?? g.AchievementsTotal),
          numAchieved: num(progress.NumAchieved),
          numAchievedHardcore: num(progress.NumAchievedHardcore),
          possibleScore: num(progress.PossibleScore),
          scoreAchieved: num(progress.ScoreAchieved),
        };
      });

      const profile = {
        syncedAt,
        user: String(summary.User ?? username),
        profileUrl: `${RA_SITE}/user/${encodeURIComponent(summary.User ?? username)}`,
        avatar: raImage(summary.UserPic || `/UserPic/${username}.png`),
        memberSince: summary.MemberSince ?? '',
        motto: String(summary.Motto ?? ''),
        richPresence: String(summary.RichPresenceMsg ?? ''),
        points: num(summary.TotalPoints),
        softcorePoints: num(summary.TotalSoftcorePoints),
        truePoints: num(summary.TotalTruePoints),
        rank: summary.Rank != null ? num(summary.Rank) : null,
        totalRanked: summary.TotalRanked != null ? num(summary.TotalRanked) : null,
        lastGameId: summary.LastGameID != null ? num(summary.LastGameID) : null,
        stats: {
          gamesPlayed: completion.length,
          masteries: num(awardsRaw.MasteryAwardsCount),
          completions: num(awardsRaw.CompletionAwardsCount),
          beatenHardcore: num(awardsRaw.BeatenHardcoreAwardsCount),
          beatenSoftcore: num(awardsRaw.BeatenSoftcoreAwardsCount),
          achievementsEarned: completion.reduce((sum, c) => sum + c.numAwarded, 0),
        },
        recentlyPlayed,
        recentAchievements,
        completion,
        awards,
      };
      await store.saveRaProfile(profile);
      log('Saved src/data/ra-profile.json');

      // Per-game snapshots for every library game linked to RA.
      const games = (await store.listGames()).filter((g) => g.raGameId);
      job.progress = { done: 0, total: games.length };
      log(`Fetching achievements for ${games.length} linked games...`);
      let enriched = 0;
      let statusChanges = 0;
      let hourUpdates = 0;
      let dateUpdates = 0;
      for (const game of games) {
        try {
          const raw = await client.getGameInfoAndUserProgress(game.raGameId);
          const snapshot = normalizeGameProgress(raw, syncedAt);
          await store.saveRaGame(game.raGameId, snapshot);

          const patch = {};
          if (!game.cover && snapshot.imageBoxArt) patch.cover = snapshot.imageBoxArt;
          if (!game.developer && raw.Developer) patch.developer = String(raw.Developer);
          if (!game.publisher && raw.Publisher) patch.publisher = String(raw.Publisher);
          if ((!game.genres || game.genres.length === 0) && raw.Genre) patch.genres = String(raw.Genre).split(/[,/]/).map((s) => s.trim()).filter(Boolean);
          if (!game.releaseYear && releaseYearFrom(raw.Released)) patch.releaseYear = releaseYearFrom(raw.Released);
          if (autoStatus) {
            const next = upgradedStatus(game.status, snapshot.highestAwardKind, snapshot.numAwarded);
            if (next !== game.status) {
              patch.status = next;
              if (!game.finishedAt && snapshot.highestAwardDate && DONE_RANK[next]) patch.finishedAt = String(snapshot.highestAwardDate).slice(0, 10);
              statusChanges++;
            }
          }
          if (autoDates) {
            // Only ever fills blanks: a date you typed stays.
            const started = firstUnlockDate(snapshot);
            const finished = finishDate(snapshot);
            if (!game.startedAt && started) {
              patch.startedAt = started;
              dateUpdates++;
            }
            if (!game.finishedAt && finished) {
              patch.finishedAt = finished;
              dateUpdates++;
            }
          }
          if (autoHours && snapshot.playtimeSeconds > 0) {
            // RA only counts sessions played while connected, so it may only ever raise the number,
            // never lower a value you typed yourself (e.g. hours on real hardware).
            const hours = playtimeHours(snapshot.playtimeSeconds);
            if (hours > (game.hoursPlayed ?? 0)) {
              patch.hoursPlayed = hours;
              hourUpdates++;
            }
          }
          if (Object.keys(patch).length > 0) {
            await store.saveGame(game.slug, { ...game, ...patch, updatedAt: syncedAt });
            enriched++;
          }
          const extras = [
            snapshot.playtimeSeconds > 0 ? `${playtimeHours(snapshot.playtimeSeconds)}h tracked` : '',
            patch.hoursPlayed ? `hours -> ${patch.hoursPlayed}` : '',
            patch.startedAt ? `started ${patch.startedAt}` : '',
            patch.finishedAt ? `finished ${patch.finishedAt}` : '',
            patch.status ? `status -> ${patch.status}` : '',
          ].filter(Boolean);
          log(`  ${snapshot.title}: ${snapshot.numAwarded}/${snapshot.numAchievements}${extras.length ? ` (${extras.join(', ')})` : ''}`);
        } catch (err) {
          log(`  ${game.title}: FAILED (${err.message})`);
        }
        job.progress.done++;
      }

      // Subsets of linked games: RA lists them as separate games in the completion progress, but the
      // site folds them into the main game's page, so fetch them here rather than as library entries.
      const linked = new Set(games.map((g) => Number(g.raGameId)));
      const subsetIds = new Set();
      const subsetCandidates = completion.filter((c) => isSubsetTitle(c.title) && !linked.has(c.gameId));
      if (subsetCandidates.length) log(`Checking ${subsetCandidates.length} RA subset(s)...`);
      for (const candidate of subsetCandidates) {
        try {
          const raw = await client.getGameInfoAndUserProgress(candidate.gameId);
          const snapshot = normalizeGameProgress(raw, syncedAt);
          if (snapshot.parentGameId && linked.has(snapshot.parentGameId)) {
            await store.saveRaGame(candidate.gameId, snapshot);
            subsetIds.add(candidate.gameId);
            const parent = games.find((g) => Number(g.raGameId) === snapshot.parentGameId);
            const notes = [];
            if (parent && (autoHours || autoDates)) {
              // Same rules as for games, applied to the subset's journal row on the parent.
              const current = await store.getGame(parent.slug);
              const subsets = [...(current.subsets ?? [])];
              const row = subsets.find((s) => Number(s.raGameId) === candidate.gameId) ?? (subsets.push({ raGameId: candidate.gameId }), subsets[subsets.length - 1]);
              const hours = playtimeHours(snapshot.playtimeSeconds);
              if (autoHours && hours > (row.hoursPlayed ?? 0)) {
                row.hoursPlayed = hours;
                hourUpdates++;
                notes.push(`hours -> ${hours}`);
              }
              if (autoDates) {
                const started = firstUnlockDate(snapshot);
                const finished = finishDate(snapshot);
                if (!row.startedAt && started) {
                  row.startedAt = started;
                  dateUpdates++;
                  notes.push(`started ${started}`);
                }
                if (!row.finishedAt && finished) {
                  row.finishedAt = finished;
                  dateUpdates++;
                  notes.push(`finished ${finished}`);
                }
              }
              if (notes.length) await store.saveGame(parent.slug, { ...current, subsets, updatedAt: syncedAt });
            }
            const note = notes.length ? `, ${notes.join(', ')}` : '';
            log(`  ${snapshot.title}: ${snapshot.numAwarded}/${snapshot.numAchievements} (subset of ${parent?.title ?? snapshot.parentGameId}${note})`);
          }
        } catch (err) {
          log(`  ${candidate.title}: FAILED (${err.message})`);
        }
      }

      // Drop snapshots for games that are no longer linked (subsets of linked games stay).
      for (const id of await store.listRaGameIds()) {
        if (!linked.has(id) && !subsetIds.has(id)) {
          await store.deleteRaGame(id);
          log(`  Removed stale snapshot ra-games/${id}.json`);
        }
      }

      job.summary = { games: games.length, subsets: subsetIds.size, enriched, statusChanges, hourUpdates, dateUpdates, points: profile.points, recent: recentAchievements.length, completion: completion.length };
      log(`Done. ${enriched} game entries enriched, ${hourUpdates} hours-played updates, ${dateUpdates} dates filled in, ${statusChanges} status changes.`);
    } catch (err) {
      job.error = err.message;
      log(`ERROR: ${err.message}`);
    } finally {
      job.running = false;
      job.finishedAt = new Date().toISOString();
    }
  })();

  return syncStatus();
}

/* ---------------- import helpers ---------------- */

/**
 * Games from the last sync's completion list that are not in the library yet. Subsets of a game that
 * is already in the library are left out: the sync attaches those to the main game's page instead.
 */
export async function importCandidates() {
  const [profile, games, platforms] = await Promise.all([store.getRaProfile(), store.listGames(), store.getPlatforms()]);
  const linked = new Set(games.map((g) => Number(g.raGameId)).filter(Boolean));
  const completion = profile.completion ?? [];
  const linkedTitles = new Set(completion.filter((c) => linked.has(c.gameId)).map((c) => `${c.consoleId}:${c.title.toLowerCase()}`));
  const belongsToLibraryGame = (c) => isSubsetTitle(c.title) && linkedTitles.has(`${c.consoleId}:${subsetParentTitle(c.title).toLowerCase()}`);
  return completion
    .filter((c) => !linked.has(c.gameId) && !belongsToLibraryGame(c))
    .map((c) => {
      const { title, tag } = splitRaTitle(c.title);
      const platform = platformForConsole(platforms, c.consoleId, c.consoleName);
      return {
        gameId: c.gameId,
        title,
        tag,
        consoleId: c.consoleId,
        consoleName: c.consoleName,
        imageIcon: c.imageIcon,
        numAwarded: c.numAwarded,
        maxPossible: c.maxPossible,
        highestAwardKind: c.highestAwardKind,
        mostRecentAwardedDate: c.mostRecentAwardedDate,
        suggestedStatus: statusFromAwardKind(c.highestAwardKind, c.numAwarded),
        platform: platform?.id ?? null,
      };
    });
}

/** Creates library entries for the given RA game ids. Returns the created games. */
export async function importGames(selection) {
  const { username, apiKey } = raConfig();
  const client = new RaClient({ username, apiKey });
  const profile = await store.getRaProfile();
  const completionById = new Map((profile.completion ?? []).map((c) => [c.gameId, c]));
  const created = [];
  const errors = [];

  for (const pick of selection) {
    const gameId = Number(pick.gameId);
    const entry = completionById.get(gameId);
    if (!entry) {
      errors.push({ gameId, message: 'Not in the last sync. Run a sync first.' });
      continue;
    }
    try {
      const existing = (await store.listGames()).find((g) => Number(g.raGameId) === gameId);
      if (existing) {
        errors.push({ gameId, message: `Already in the library as "${existing.slug}"` });
        continue;
      }
      const info = await client.getGame(gameId);
      const { title, tag } = splitRaTitle(info.Title ?? entry.title);
      const platform = pick.platform ? { id: pick.platform } : await ensurePlatform(entry.consoleId, entry.consoleName);
      const slug = await uniqueSlug(slugify(title) || `ra-${gameId}`, store.gameExists);
      const status = STATUS_IDS.includes(pick.status) ? pick.status : statusFromAwardKind(entry.highestAwardKind, entry.numAwarded);
      const timestamp = store.now();
      const game = {
        title,
        platform: platform.id,
        cover: raImage(info.ImageBoxArt) || undefined,
        genres: String(info.Genre ?? '').split(/[,/]/).map((s) => s.trim()).filter(Boolean),
        developer: info.Developer ? String(info.Developer) : undefined,
        publisher: info.Publisher ? String(info.Publisher) : undefined,
        releaseYear: releaseYearFrom(info.Released),
        ownership: 'owned',
        favorite: false,
        status,
        finishedAt: DONE_RANK[status] && entry.highestAwardDate ? String(entry.highestAwardDate).slice(0, 10) : undefined,
        raGameId: gameId,
        tags: tag ? [tag] : [],
        addedAt: timestamp,
        updatedAt: timestamp,
      };
      await store.saveGame(slug, game);
      created.push({ slug, ...game });
    } catch (err) {
      errors.push({ gameId, message: err.message });
    }
  }
  return { created, errors };
}

/** Pulls RA's console list and adds any console that has no matching platform yet. */
export async function importConsoles() {
  const { username, apiKey } = raConfig();
  const client = new RaClient({ username, apiKey });
  const consoles = await client.getConsoleIds();
  const platforms = await store.getPlatforms();
  let added = 0;
  let linked = 0;
  for (const c of consoles) {
    if (!c.IsGameSystem) continue;
    const id = Number(c.ID);
    const name = String(c.Name ?? '').trim();
    if (platforms.some((p) => p.raConsoleId === id)) continue;
    const slug = slugify(name) || `ra-${id}`;
    const bySlug = platforms.find((p) => p.id === slug);
    if (bySlug) {
      if (bySlug.raConsoleId == null) {
        bySlug.raConsoleId = id;
        linked++;
      }
      continue;
    }
    platforms.push({ id: slug, name, short: shortNameFor(name), raConsoleId: id });
    added++;
  }
  await store.savePlatforms(platforms);
  return { total: consoles.length, added, linked };
}

/* ---------------- subsets that were imported as separate library games ---------------- */

/**
 * Library games that are really RA subsets of another library game (e.g. "Terraria [Subset -
 * Completionist]" next to "Terraria"). Matched through the snapshot's parentGameId when the sync has
 * recorded it, otherwise through RA's title convention on the same console.
 */
export async function subsetEntries() {
  const games = await store.listGames();
  const linked = games.filter((g) => g.raGameId);
  const byRaId = new Map(linked.map((g) => [Number(g.raGameId), g]));
  const out = [];
  for (const game of linked) {
    if (!isSubsetTitle(game.title)) continue;
    const snapshot = await store.getRaGame(game.raGameId);
    let parent = snapshot?.parentGameId ? byRaId.get(Number(snapshot.parentGameId)) : undefined;
    if (!parent) {
      const wanted = subsetParentTitle(game.title).toLowerCase();
      parent = linked.find((g) => g.slug !== game.slug && g.platform === game.platform && subsetParentTitle(g.title).toLowerCase() === wanted && !isSubsetTitle(g.title));
    }
    if (!parent) continue;
    out.push({
      slug: game.slug,
      title: game.title,
      raGameId: Number(game.raGameId),
      hoursPlayed: game.hoursPlayed ?? null,
      status: game.status,
      parent: { slug: parent.slug, title: parent.title, raGameId: Number(parent.raGameId) },
      snapshot: Boolean(snapshot),
    });
  }
  return out;
}

/**
 * Folds a subset's library entry into its parent:
 *  - the snapshot is marked with the parent's RA id (so the game page shows it as a tab right away);
 *  - the entry's own rating / hours / started / finished move into the parent's `subsets` journal;
 *  - guides and trackers that pointed at the subset entry are re-pointed at the parent;
 *  - the separate game entry is removed. The parent's own stats, status and notes are left alone.
 */
export async function mergeSubset(slug) {
  const entry = (await subsetEntries()).find((s) => s.slug === slug);
  if (!entry) throw new HttpError(404, `"${slug}" is not a subset of another library game`);
  const [subset, parent, snapshot, refs] = await Promise.all([
    store.getGame(slug),
    store.getGame(entry.parent.slug),
    store.getRaGame(entry.raGameId),
    store.referencesToGame(slug),
  ]);
  const stamp = store.now();

  if (snapshot) await store.saveRaGame(entry.raGameId, { ...snapshot, parentGameId: entry.parent.raGameId });

  const journal = { raGameId: entry.raGameId };
  for (const key of ['rating', 'hoursPlayed', 'startedAt', 'finishedAt']) if (subset[key] !== undefined && subset[key] !== null && subset[key] !== '') journal[key] = subset[key];
  const subsets = (parent.subsets ?? []).filter((s) => Number(s.raGameId) !== entry.raGameId);
  subsets.push(journal);
  await store.saveGame(parent.slug, { ...parent, subsets, updatedAt: stamp });

  for (const guideSlug of refs.guides) {
    const guide = await store.getGuide(guideSlug);
    await store.saveGuide(guideSlug, { ...guide, game: parent.slug, updatedAt: stamp }, guide.body);
  }
  for (const trackerSlug of refs.trackers) {
    const tracker = await store.getTracker(trackerSlug);
    await store.saveTracker(trackerSlug, { ...tracker, game: parent.slug, updatedAt: stamp });
  }

  await store.deleteGame(slug);
  return { merged: entry, moved: refs, remaining: await subsetEntries() };
}

/** The RA subsets attached to a main game (snapshots whose parentGameId is that game), for the game editor. */
export async function subsetsOf(raGameId) {
  const id = Number(raGameId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const out = [];
  for (const snapshotId of await store.listRaGameIds()) {
    const snapshot = await store.getRaGame(snapshotId);
    if (!snapshot || Number(snapshot.parentGameId) !== id) continue;
    const match = /\[subset\s*-\s*([^\]]+)\]/i.exec(snapshot.title ?? '');
    out.push({
      raGameId: snapshot.gameId,
      title: snapshot.title,
      label: match ? match[1].trim() : snapshot.title,
      numAchievements: snapshot.numAchievements ?? 0,
      numAwarded: snapshot.numAwarded ?? 0,
      highestAwardKind: snapshot.highestAwardKind ?? null,
      playtimeHours: playtimeHours(snapshot.playtimeSeconds),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
