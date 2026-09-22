import { STATUS_IDS, steamStoreUrl, steamCoverUrl, steamHeaderUrl } from '../../src/lib/constants.js';
import { HttpError } from './errors.js';
import { slugify, uniqueSlug } from './slug.js';
import * as store from './store.js';
import { firstUnlockDate } from './ra.js';

/*
 * Steam Web API. Needs a free key (steamcommunity.com/dev/apikey) and your SteamID64, both in .env;
 * the profile's "Game details" must be public or the achievement / playtime calls return nothing.
 * Like the RA sync, everything ends up as files the site reads: one achievement set per Steam-linked
 * game in src/content/achievement-sets/<slug>-steam.json.
 */

const API_BASE = 'https://api.steampowered.com/';
const STORE_API = 'https://store.steampowered.com/api/appdetails';
const USER_AGENT = 'huntthepast-questlog-admin/1.0 (+https://github.com/huntthepast)';
const REQUEST_GAP_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function steamConfig() {
  const apiKey = (process.env.STEAM_API_KEY ?? '').trim();
  const steamId = (process.env.STEAM_ID ?? '').trim();
  return { apiKey, steamId, configured: Boolean(apiKey && steamId) };
}

export class SteamClient {
  constructor({ apiKey, steamId }) {
    if (!apiKey || !steamId) throw new HttpError(400, 'Steam is not configured. Set STEAM_API_KEY and STEAM_ID in .env and restart the admin.');
    this.apiKey = apiKey;
    this.steamId = steamId;
    this.lastCall = 0;
  }

  async call(path, params = {}) {
    const wait = this.lastCall + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
    const url = new URL(path, API_BASE);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Steam rejected the API key (or the profile is private). Check STEAM_API_KEY / STEAM_ID in .env and the profile privacy settings.');
    if (res.status === 429) throw new HttpError(429, 'Steam rate limit hit. Wait a minute and try again.');
    if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : 400, `Steam ${path} failed with HTTP ${res.status}`);
    return res.json();
  }

  /** Every owned game with playtime (minutes) and last-played time. */
  async getOwnedGames() {
    const data = await this.call('IPlayerService/GetOwnedGames/v1/', { steamid: this.steamId, include_appinfo: 1, include_played_free_games: 1 });
    return data.response?.games ?? [];
  }

  /** The achievement list of a game (names, descriptions, icons, hidden flag). Empty when the game has none. */
  async getSchema(appId) {
    const data = await this.call('ISteamUserStats/GetSchemaForGame/v2/', { appid: appId, l: 'english' });
    return data.game?.availableGameStats?.achievements ?? [];
  }

  /** Which achievements the user unlocked and when. Empty (not an error) for games without stats. */
  async getPlayerAchievements(appId) {
    try {
      const data = await this.call('ISteamUserStats/GetPlayerAchievements/v1/', { steamid: this.steamId, appid: appId, l: 'english' });
      return data.playerstats?.achievements ?? [];
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) return []; // "Requested app has no stats" comes back as HTTP 400
      throw err;
    }
  }

  /** Global unlock percentages, keyed by achievement id. Tolerates games without stats. */
  async getGlobalPercentages(appId) {
    try {
      const data = await this.call('ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', { gameid: appId });
      return new Map((data.achievementpercentages?.achievements ?? []).map((a) => [a.name, num(a.percent)]));
    } catch {
      return new Map();
    }
  }
}

/** Store metadata (no key needed): name, art, developers, publishers, genres, release date. */
export async function appDetails(appId) {
  const id = Number(appId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid Steam app id');
  const res = await fetch(`${STORE_API}?appids=${id}&l=english`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new HttpError(502, `Steam store lookup failed with HTTP ${res.status}`);
  const data = (await res.json())?.[id];
  if (!data?.success || !data.data) throw new HttpError(404, `Steam knows no app ${id}`);
  const d = data.data;
  return {
    appId: id,
    title: String(d.name ?? ''),
    header: d.header_image ?? steamHeaderUrl(id),
    developers: d.developers ?? [],
    publishers: d.publishers ?? [],
    genres: (d.genres ?? []).map((g) => String(g.description)),
    releaseYear: /(\d{4})/.exec(String(d.release_date?.date ?? ''))?.[1] ? Number(/(\d{4})/.exec(String(d.release_date.date))[1]) : undefined,
    achievementsTotal: num(d.achievements?.total),
  };
}

/** Steam's portrait art exists for most games; older ones only have the wide header. */
async function bestCover(appId) {
  const portrait = steamCoverUrl(appId);
  try {
    const res = await fetch(portrait, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return portrait;
  } catch {
    /* fall through */
  }
  return steamHeaderUrl(appId);
}

const unixToIso = (seconds) => (num(seconds) > 0 ? new Date(num(seconds) * 1000).toISOString() : null);

/** Merges the schema (the full list) with the player's unlocks and global rarity into set achievements. */
export function buildAchievements(schema, player, percentages) {
  const unlocked = new Map(player.map((a) => [a.apiname, a]));
  return schema.map((a) => {
    const mine = unlocked.get(a.name);
    return {
      id: String(a.name),
      title: String(a.displayName ?? a.name),
      description: String(a.description ?? mine?.description ?? ''),
      icon: a.icon || undefined,
      iconLocked: a.icongray || undefined,
      hidden: num(a.hidden) === 1,
      unlockedAt: mine && num(mine.achieved) === 1 ? unixToIso(mine.unlocktime) : null,
      rarity: percentages.has(a.name) ? Math.round(percentages.get(a.name) * 10) / 10 : null,
    };
  });
}

/* ---------------- sync job ---------------- */

const job = { running: false, startedAt: null, finishedAt: null, error: null, log: [], progress: { done: 0, total: 0 }, summary: null };

export const syncStatus = () => ({ ...job, log: job.log.slice(-200) });

function log(message) {
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
  console.log(`[steam] ${message}`);
}

const setSlugFor = (gameSlug) => `${gameSlug}-steam`;

export function startSync({ autoStatus = false, autoHours = true, autoDates = true } = {}) {
  if (job.running) throw new HttpError(409, 'A Steam sync is already running');
  const client = new SteamClient(steamConfig());
  Object.assign(job, { running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null, log: [], progress: { done: 0, total: 0 }, summary: null });

  (async () => {
    try {
      const syncedAt = new Date().toISOString();
      const games = (await store.listGames()).filter((g) => g.steamAppId);
      job.progress = { done: 0, total: games.length };
      log(`Loading the Steam library...`);
      const owned = new Map((await client.getOwnedGames()).map((g) => [num(g.appid), g]));
      log(`${owned.size} games on the Steam account. Syncing ${games.length} linked library games...`);

      let hourUpdates = 0;
      let dateUpdates = 0;
      let statusChanges = 0;
      let enriched = 0;
      for (const game of games) {
        const appId = num(game.steamAppId);
        try {
          const [schema, player, percentages] = await Promise.all([client.getSchema(appId), client.getPlayerAchievements(appId), client.getGlobalPercentages(appId)]);
          const achievements = buildAchievements(schema, player, percentages);
          const played = owned.get(appId);
          const playtimeMinutes = num(played?.playtime_forever);
          const slug = setSlugFor(game.slug);
          const existing = (await store.setExists(slug)) ? await store.getSet(slug) : null;
          const set = {
            title: 'Steam',
            source: 'steam',
            game: game.slug,
            appId,
            url: steamStoreUrl(appId),
            playtimeMinutes,
            lastPlayedAt: unixToIso(played?.rtime_last_played) ?? undefined,
            syncedAt,
            journal: existing?.journal ?? {},
            achievements,
            createdAt: existing?.createdAt ?? syncedAt,
            updatedAt: syncedAt,
          };

          const unlockedCount = achievements.filter((a) => a.unlockedAt).length;
          const hours = Math.round((playtimeMinutes / 60) * 10) / 10;
          const started = firstUnlockDate({ achievements: achievements.map((a) => ({ earnedAt: a.unlockedAt, earnedHardcoreAt: null })) });
          const allDone = achievements.length > 0 && unlockedCount === achievements.length;
          const finished = allDone ? achievements.map((a) => a.unlockedAt).sort().at(-1)?.slice(0, 10) ?? null : null;
          const notes = [];

          if (game.raGameId) {
            // RetroAchievements is the game's primary tracker: Steam only fills the set's own journal.
            const journal = { ...set.journal };
            if (autoHours && hours > (journal.hoursPlayed ?? 0)) {
              journal.hoursPlayed = hours;
              hourUpdates++;
              notes.push(`set hours -> ${hours}`);
            }
            if (autoDates && !journal.startedAt && started) {
              journal.startedAt = started;
              dateUpdates++;
              notes.push(`set started ${started}`);
            }
            if (autoDates && !journal.finishedAt && finished) {
              journal.finishedAt = finished;
              dateUpdates++;
              notes.push(`set finished ${finished}`);
            }
            set.journal = journal;
          } else {
            // Steam is the primary tracker: same rules as the RA sync, on the game itself.
            const patch = {};
            if (autoHours && hours > (game.hoursPlayed ?? 0)) {
              patch.hoursPlayed = hours;
              hourUpdates++;
              notes.push(`hours -> ${hours}`);
            }
            if (autoDates && !game.startedAt && started) {
              patch.startedAt = started;
              dateUpdates++;
              notes.push(`started ${started}`);
            }
            if (autoDates && !game.finishedAt && finished) {
              patch.finishedAt = finished;
              dateUpdates++;
              notes.push(`finished ${finished}`);
            }
            if (autoStatus) {
              const next = allDone ? 'completed' : unlockedCount > 0 || playtimeMinutes > 0 ? 'played' : null;
              const rank = { unplayed: 0, playing: 1, 'on-hold': 1, played: 1, dropped: 1, beaten: 2, completed: 3, mastered: 4 };
              if (next && (rank[next] ?? 0) > (rank[game.status] ?? 0)) {
                patch.status = next;
                statusChanges++;
                notes.push(`status -> ${next}`);
              }
            }
            if (!game.cover) patch.cover = await bestCover(appId);
            if (!game.developer || !game.publisher || !game.releaseYear || !(game.genres ?? []).length) {
              try {
                const info = await appDetails(appId);
                if (!game.developer && info.developers[0]) patch.developer = info.developers.join(', ');
                if (!game.publisher && info.publishers[0]) patch.publisher = info.publishers.join(', ');
                if (!game.releaseYear && info.releaseYear) patch.releaseYear = info.releaseYear;
                if (!(game.genres ?? []).length && info.genres.length) patch.genres = info.genres;
              } catch {
                /* store metadata is optional */
              }
            }
            if (Object.keys(patch).length) {
              await store.saveGame(game.slug, { ...game, ...patch, updatedAt: syncedAt });
              enriched++;
            }
          }

          await store.saveSet(slug, set);
          log(`  ${game.title}: ${unlockedCount}/${achievements.length}${hours ? ` (${hours}h)` : ''}${notes.length ? ` (${notes.join(', ')})` : ''}`);
        } catch (err) {
          log(`  ${game.title}: FAILED (${err.message})`);
        }
        job.progress.done++;
      }

      // Steam sets of games that are no longer linked go away.
      const linked = new Set(games.map((g) => setSlugFor(g.slug)));
      for (const set of await store.listSets()) {
        if (set.source === 'steam' && !linked.has(set.slug)) {
          await store.deleteSet(set.slug);
          log(`  Removed stale set achievement-sets/${set.slug}.json`);
        }
      }

      job.summary = { games: games.length, owned: owned.size, hourUpdates, dateUpdates, statusChanges, enriched };
      log(`Done. ${hourUpdates} hours-played updates, ${dateUpdates} dates filled in, ${statusChanges} status changes, ${enriched} entries enriched.`);
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

/* ---------------- import ---------------- */

/** Owned Steam games that are not in the library yet, most played first. */
export async function importCandidates() {
  const client = new SteamClient(steamConfig());
  const games = await store.listGames();
  const linked = new Set(games.map((g) => Number(g.steamAppId)).filter(Boolean));
  return (await client.getOwnedGames())
    .filter((g) => !linked.has(num(g.appid)))
    .map((g) => ({
      appId: num(g.appid),
      title: String(g.name ?? `App ${g.appid}`),
      playtimeMinutes: num(g.playtime_forever),
      lastPlayedAt: unixToIso(g.rtime_last_played),
      icon: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null,
      cover: steamHeaderUrl(num(g.appid)),
    }))
    .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes || a.title.localeCompare(b.title));
}

/** The platform Steam games go under: "pc" if it exists, else any platform whose short name is PC. */
async function pcPlatform(requested) {
  const platforms = await store.getPlatforms();
  const pick = (requested && platforms.find((p) => p.id === requested)) || platforms.find((p) => p.id === 'pc') || platforms.find((p) => String(p.short).toUpperCase() === 'PC');
  if (!pick) throw new HttpError(400, 'Add a PC platform first (Settings -> Platforms), then import again.');
  return pick;
}

/** Creates library entries for the given Steam app ids. */
export async function importGames(selection) {
  const candidates = new Map((await importCandidates()).map((c) => [c.appId, c]));
  const created = [];
  const errors = [];
  for (const pick of selection) {
    const appId = num(pick.appId);
    const candidate = candidates.get(appId);
    if (!candidate) {
      errors.push({ appId, message: 'Not in the Steam library, or already imported' });
      continue;
    }
    try {
      const platform = await pcPlatform(pick.platform);
      const slug = await uniqueSlug(slugify(candidate.title) || `steam-${appId}`, store.gameExists);
      const hours = Math.round((candidate.playtimeMinutes / 60) * 10) / 10;
      const status = STATUS_IDS.includes(pick.status) ? pick.status : candidate.playtimeMinutes > 0 ? 'played' : 'unplayed';
      const timestamp = store.now();
      let info = null;
      try {
        info = await appDetails(appId);
      } catch {
        /* optional */
      }
      const game = {
        title: candidate.title,
        platform: platform.id,
        cover: await bestCover(appId),
        genres: info?.genres ?? [],
        developer: info?.developers?.length ? info.developers.join(', ') : undefined,
        publisher: info?.publishers?.length ? info.publishers.join(', ') : undefined,
        releaseYear: info?.releaseYear,
        ownership: 'owned',
        favorite: false,
        status,
        hoursPlayed: hours || undefined,
        steamAppId: appId,
        tags: [],
        addedAt: timestamp,
        updatedAt: timestamp,
      };
      await store.saveGame(slug, game);
      created.push({ slug, ...game });
    } catch (err) {
      errors.push({ appId, message: err.message });
    }
  }
  return { created, errors };
}

/** The achievement list of a Steam app, for filling a manual set (GOG copies of Steam games have the same list). */
export async function schemaFor(appId) {
  const client = new SteamClient(steamConfig());
  const id = num(appId);
  if (!id) throw new HttpError(400, 'Invalid Steam app id');
  const [schema, percentages] = await Promise.all([client.getSchema(id), client.getGlobalPercentages(id)]);
  return buildAchievements(schema, [], percentages);
}
