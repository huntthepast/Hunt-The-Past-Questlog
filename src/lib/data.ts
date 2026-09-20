import { getCollection, type CollectionEntry } from 'astro:content';
import { marked } from 'marked';
import platforms from '../data/platforms.json';
import site from '../data/site.json';
import raProfileJson from '../data/ra-profile.json';
import shelfJson from '../data/shelf.json';
import { STATUSES, statusById } from './constants.js';

export type Game = CollectionEntry<'games'>;
export type Guide = CollectionEntry<'guides'>;
export type Tracker = CollectionEntry<'trackers'>;
export type RaGame = CollectionEntry<'raGames'>;

export type Platform = { id: string; name: string; short: string; raConsoleId: number | null };

/* Shape of src/data/ra-profile.json (written by the admin's RetroAchievements sync). */
export type RaRecentAchievement = {
  date: string;
  hardcore: boolean;
  id: number;
  title: string;
  description: string;
  points: number;
  trueRatio: number;
  badge: string;
  type: string | null;
  gameId: number;
  gameTitle: string;
  consoleName: string;
};

export type RaCompletionEntry = {
  gameId: number;
  title: string;
  consoleId: number;
  consoleName: string;
  imageIcon: string;
  maxPossible: number;
  numAwarded: number;
  numAwardedHardcore: number;
  mostRecentAwardedDate: string | null;
  highestAwardKind: string | null;
  highestAwardDate: string | null;
};

export type RaAward = {
  awardedAt: string;
  type: string;
  gameId: number | null;
  hardcore: boolean;
  title: string;
  consoleName: string;
  imageIcon: string;
  /** Position from "Reorder Site Awards" on RA; absent in snapshots taken before it was recorded. */
  displayOrder?: number;
};

/** Manual trophy-shelf overrides edited in the admin (src/data/shelf.json). Empty = follow RA. */
export type Shelf = { order: number[]; hidden: number[] };

export type RaRecentlyPlayed = {
  gameId: number;
  title: string;
  consoleName: string;
  imageIcon: string;
  lastPlayed: string;
  numPossible: number;
  numAchieved: number;
  numAchievedHardcore: number;
  possibleScore: number;
  scoreAchieved: number;
};

export type RaProfile = {
  syncedAt: string | null;
  user: string;
  profileUrl: string;
  avatar: string;
  memberSince: string;
  motto: string;
  richPresence: string;
  points: number;
  softcorePoints: number;
  truePoints: number;
  rank: number | null;
  totalRanked: number | null;
  lastGameId: number | null;
  stats: {
    gamesPlayed: number;
    masteries: number;
    completions: number;
    beatenHardcore: number;
    beatenSoftcore: number;
    achievementsEarned: number;
  };
  recentlyPlayed: RaRecentlyPlayed[];
  recentAchievements: RaRecentAchievement[];
  completion: RaCompletionEntry[];
  awards: RaAward[];
};

const raProfile = raProfileJson as unknown as RaProfile;
const shelf = shelfJson as Shelf;

export { site, platforms, raProfile, shelf };

/* ---------- platforms ---------- */

export function platformOf(id: string): Platform {
  return (platforms as Platform[]).find((p) => p.id === id) ?? { id, name: id, short: id.toUpperCase(), raConsoleId: null };
}

/* ---------- sorting ---------- */

const ARTICLES = /^(the|a|an)\s+/i;
export const sortKey = (title: string) => title.replace(ARTICLES, '').toLowerCase();
export const byTitle = (a: Game, b: Game) => sortKey(a.data.title).localeCompare(sortKey(b.data.title));
export const byUpdatedDesc = <T extends { data: { updatedAt: string } }>(a: T, b: T) => b.data.updatedAt.localeCompare(a.data.updatedAt);

/* ---------- games ---------- */

export async function allGames(): Promise<Game[]> {
  const games = await getCollection('games');
  return games.sort(byTitle);
}

export const libraryGames = async () => (await allGames()).filter((g) => g.data.ownership === 'owned');
export const wishlistGames = async () => (await allGames()).filter((g) => g.data.ownership === 'wishlist');
export const favoriteGames = async () => (await allGames()).filter((g) => g.data.favorite);

export const isDone = (game: Game) => statusById(game.data.status).done;
export const isPlayed = (game: Game) => statusById(game.data.status).played;

/** Games grouped by status, in the canonical status order. Empty groups are dropped. */
export function groupByStatus(games: Game[]) {
  return STATUSES.map((status) => ({
    status,
    games: games.filter((g) => g.data.status === status.id),
  })).filter((group) => group.games.length > 0);
}

export function libraryStats(games: Game[]) {
  const owned = games.filter((g) => g.data.ownership === 'owned');
  const done = owned.filter(isDone);
  const played = owned.filter(isPlayed);
  const hours = owned.reduce((sum, g) => sum + (g.data.hoursPlayed ?? 0), 0);
  return {
    owned: owned.length,
    wishlist: games.filter((g) => g.data.ownership === 'wishlist').length,
    favorites: games.filter((g) => g.data.favorite).length,
    playing: owned.filter((g) => g.data.status === 'playing').length,
    played: played.length,
    done: done.length,
    donePct: owned.length ? Math.round((done.length / owned.length) * 100) : 0,
    hours,
    platforms: new Set(owned.map((g) => g.data.platform)).size,
  };
}

/* ---------- guides & trackers ---------- */

export async function allGuides(): Promise<Guide[]> {
  const guides = await getCollection('guides', ({ data }) => !data.draft);
  return guides.sort(byUpdatedDesc);
}

export async function allTrackers(): Promise<Tracker[]> {
  const trackers = await getCollection('trackers');
  return trackers.sort(byUpdatedDesc);
}

export const guidesForGame = (guides: Guide[], gameId: string) => guides.filter((g) => g.data.game?.id === gameId);
export const trackersForGame = (trackers: Tracker[], gameId: string) => trackers.filter((t) => t.data.game?.id === gameId);

const seriesKey = (guide: Guide) => (guide.data.series ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The multi-part series a guide belongs to: the other guides of the same game that carry the same
 * `series` name, in `order`. Only an explicit series name chains guides - a guide without one is
 * standalone, whatever its type - so `prev`/`next` never point at an unrelated guide or a tracker.
 */
export function guideSeries(guides: Guide[], guide: Guide) {
  const key = seriesKey(guide);
  const gameId = guide.data.game?.id;
  if (!key || !gameId) return null;
  const parts = guides
    .filter((g) => g.data.game?.id === gameId && seriesKey(g) === key)
    .sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
  if (parts.length < 2) return null;
  const index = parts.findIndex((g) => g.id === guide.id);
  return {
    name: guide.data.series!.trim(),
    parts,
    index,
    prev: index > 0 ? parts[index - 1] : undefined,
    next: index >= 0 && index < parts.length - 1 ? parts[index + 1] : undefined,
  };
}

export function trackerProgress(tracker: Tracker) {
  const items = tracker.data.sections.flatMap((s) => s.items);
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/* ---------- RetroAchievements ---------- */

export async function raGameById(raGameId: number | undefined): Promise<RaGame | undefined> {
  if (!raGameId) return undefined;
  const all = await getCollection('raGames');
  return all.find((entry) => entry.data.gameId === raGameId);
}

export const raSynced = () => Boolean(raProfile.syncedAt);

/** RA profile order: DisplayOrder (set with "Reorder Site Awards" on RA), then the date earned. */
export const byRaShelfOrder = (a: RaAward, b: RaAward) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.awardedAt.localeCompare(b.awardedAt);

/** mastered > completed > beaten (hardcore) > beaten (softcore) */
export function awardRank(a: RaAward): number {
  if (a.type === 'Mastery/Completion') return a.hardcore ? 4 : 3;
  if (a.type === 'Game Beaten') return a.hardcore ? 2 : 1;
  return 0;
}

export function awardKind(a: RaAward): 'mastered' | 'completed' | 'beaten-hardcore' | 'beaten-softcore' | 'other' {
  switch (awardRank(a)) {
    case 4:
      return 'mastered';
    case 3:
      return 'completed';
    case 2:
      return 'beaten-hardcore';
    case 1:
      return 'beaten-softcore';
    default:
      return 'other';
  }
}

/**
 * Game awards for the trophy shelf: one entry per game (its best award), in RA's own order, with the
 * admin's manual overrides applied on top (games listed in shelf.order come first in that order;
 * shelf.hidden are dropped).
 */
export function shelfAwards(awards: RaAward[] = raProfile.awards, overrides: Shelf = shelf): RaAward[] {
  const hidden = new Set(overrides.hidden);
  const position = new Map(overrides.order.map((id, index) => [id, index]));
  const best = new Map<number, RaAward>();
  for (const a of awards) {
    if (a.gameId === null || awardRank(a) === 0) continue;
    const current = best.get(a.gameId);
    if (!current || awardRank(a) > awardRank(current)) best.set(a.gameId, a);
  }
  return [...best.values()]
    .filter((a) => !hidden.has(a.gameId as number))
    .sort(byRaShelfOrder)
    .sort((a, b) => {
      const pa = position.get(a.gameId as number);
      const pb = position.get(b.gameId as number);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return 0; // stable sort keeps RA order for everything not pinned manually
    });
}

/* ---------- formatting ---------- */

const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/** Accepts "YYYY-MM-DD", ISO strings, or RA's "YYYY-MM-DD HH:MM:SS". Returns '' for empty input. */
export function formatDate(value?: string | null): string {
  if (!value) return '';
  const d = parseDate(value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const d = parseDate(value);
  return Number.isNaN(d.getTime()) ? value : dateTimeFmt.format(d) + ' UTC';
}

export function parseDate(value: string): Date {
  // RA returns "2024-04-23 21:28:49" (UTC) without a zone marker.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return new Date(value.replace(' ', 'T') + 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T00:00:00Z');
  return new Date(value);
}

export function formatHours(hours?: number): string {
  if (hours === undefined || hours === null) return '';
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** RetroAchievements playtime in seconds -> "5h 12m" (or "48m" under an hour). */
export function formatPlaytime(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Sum of RA-tracked playtime across every synced game snapshot, in seconds. */
export async function raTrackedSeconds(): Promise<number> {
  const all = await getCollection('raGames');
  return all.reduce((sum, entry) => sum + (entry.data.playtimeSeconds ?? 0), 0);
}

export const formatNumber = (n: number) => new Intl.NumberFormat('en-US').format(n);

/* ---------- markdown (for free-text fields like reviews/notes) ---------- */

marked.use({ gfm: true, breaks: true });

export function renderMarkdown(source?: string): string {
  if (!source) return '';
  return marked.parse(source, { async: false }) as string;
}
