import { getCollection, type CollectionEntry } from 'astro:content';
import { marked } from 'marked';
import platforms from '../data/platforms.json';
import site from '../data/site.json';
import raProfileJson from '../data/ra-profile.json';
import shelfJson from '../data/shelf.json';
import { STATUSES, statusById, isExternalUrl, SITE_URL } from './constants.js';

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

/* ---------- outside material: credits and removal requests ---------- */

export type Source = { label: string; url?: string; note?: string; license?: string };
/** One source, with every page of this site that says it used it. */
export type SourceUse = Source & { pages: { title: string; path: string; kind: 'Guide' | 'Tracker' }[] };

// Grouped by the name being credited, not by the link: two guides can cite the same site through
// different deep links (/dw/arms/ and /dw/items/) and the person behind it is still one entry.
const sourceKey = (source: Source) => source.label.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Every outside source declared by a guide or tracker, grouped by source and sorted by name, so a
 * rights holder can find their own work on /credits instead of reading every page.
 */
export async function allSources(): Promise<SourceUse[]> {
  const pages: { entry: Guide | Tracker; path: string; kind: 'Guide' | 'Tracker' }[] = [
    ...(await allGuides()).map((entry) => ({ entry, path: `/guides/${entry.id}`, kind: 'Guide' as const })),
    ...(await allTrackers()).map((entry) => ({ entry, path: `/trackers/${entry.id}`, kind: 'Tracker' as const })),
  ];
  const grouped = new Map<string, SourceUse>();
  for (const { entry, path, kind } of pages) {
    for (const source of entry.data.sources) {
      const key = sourceKey(source);
      // The first mention sets the label and link; later ones only add their page and fill in blanks.
      const existing = grouped.get(key) ?? { ...source, pages: [] };
      existing.url ??= source.url;
      existing.license ??= source.license;
      existing.pages.push({ title: entry.data.title, path, kind });
      grouped.set(key, existing);
    }
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const contact = (site as { contact?: { email?: string; repo?: string } }).contact ?? {};

/** The issue form in .github/ISSUE_TEMPLATE that the GitHub fallback opens. */
const REMOVAL_FORM = 'removal-request.yml';

export type RemovalRoute = { kind: 'email' | 'issue'; href: string; label: string; external: boolean };

/**
 * The ways a removal request can reach the owner. Email comes first when there is an address: it is
 * private, needs no account, and a rights holder may not want to post their complaint in public. The
 * repository's issue form is offered next to it for anyone who would rather have a tracked, public
 * record - and stands in as `primary` when no address is configured, so the page is never a dead end.
 *
 * `page` is the page being complained about, which is put in the subject line - and, for the issue
 * form, in its first field - so the request arrives already saying what it is about.
 */
export function removalRequest(page?: { title: string; path: string }): { primary: RemovalRoute; alternate?: RemovalRoute } {
  const about = page ? `${page.title} (${SITE_URL}${page.path})` : SITE_URL;
  const subject = `Removal request - ${about}`;

  let email: RemovalRoute | undefined;
  if (contact.email) {
    // No form to fill in here, so the questions go in the body as a list to type under.
    const body = [
      'Which page:',
      page ? `${SITE_URL}${page.path}` : '',
      '',
      'What on it is yours:',
      '',
      'How you are connected to it (author, publisher, rights holder):',
      '',
      'Remove it, or credit it differently?',
      '',
    ].join('\n');
    email = {
      kind: 'email',
      href: `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      label: contact.email,
      external: false,
    };
  }

  let issue: RemovalRoute | undefined;
  const repo = contact.repo?.replace(/\/$/, '');
  if (repo) {
    // The issue form in .github/ISSUE_TEMPLATE asks the questions as fields and carries the "removal"
    // label itself. A ?labels= parameter would be dropped here: GitHub ignores it unless the reporter
    // can label issues, which a rights holder filing from outside never can.
    // Field ids double as prefill parameters, so `page` arrives already filled in.
    const params = new URLSearchParams({ template: REMOVAL_FORM, title: subject });
    if (page) params.set('page', `${SITE_URL}${page.path}`);
    issue = { kind: 'issue', href: `${repo}/issues/new?${params}`, label: 'removal request form', external: true };
  }

  const primary = email ?? issue ?? { kind: 'email' as const, href: '/credits#removal', label: 'the credits page', external: false };
  return { primary, alternate: email && issue ? issue : undefined };
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

/* ---------- achievement sets from other sources (Steam sync, manual) ---------- */

export type AchievementSet = CollectionEntry<'achievementSets'>;

// Astro warns on every call to getCollection() for a collection without entries; skip it while the folder is empty.
const HAS_ACHIEVEMENT_SETS = Object.keys(import.meta.glob('/src/content/achievement-sets/*.json')).length > 0;

/** The Steam / manual achievement sets attached to a game, Steam first, then by title. */
export async function achievementSetsFor(gameId: string): Promise<AchievementSet[]> {
  if (!HAS_ACHIEVEMENT_SETS) return [];
  const all = await getCollection('achievementSets');
  const rank = (s: AchievementSet) => (s.data.source === 'steam' ? 0 : 1);
  return all.filter((s) => s.data.game.id === gameId).sort((a, b) => rank(a) - rank(b) || a.data.title.localeCompare(b.data.title));
}

/** RA subsets of a game ("Game [Subset - Bonus]"): the snapshots whose parentGameId is this game's RA id. */
export async function raSubsetsOf(raGameId: number | undefined): Promise<RaGame[]> {
  if (!raGameId) return [];
  const all = await getCollection('raGames');
  return all.filter((entry) => entry.data.parentGameId === raGameId).sort((a, b) => a.data.title.localeCompare(b.data.title));
}

/** "Mega Man: Powered Up [Subset - 468 Stages]" -> "468 Stages"; anything else comes back unchanged. */
export function raSubsetLabel(title: string): string {
  const match = /\[subset\s*-\s*([^\]]+)\]/i.exec(title);
  return match ? match[1].trim() : title.replace(/^~[^~]+~\s*/, '').trim();
}

/**
 * RA game id -> path on this site. Library games map to their page; subsets of a library game map to
 * that page opened on the subset's tab. Ids the library doesn't know are absent (link to RA instead).
 */
export async function raGamePaths(games: Game[]): Promise<Map<number, string>> {
  const paths = new Map<number, string>();
  for (const g of games) if (g.data.raGameId) paths.set(g.data.raGameId, `/games/${g.id}`);
  const all = await getCollection('raGames');
  for (const ra of all) {
    const parent = ra.data.parentGameId;
    if (parent && paths.has(parent) && !paths.has(ra.data.gameId)) paths.set(ra.data.gameId, `${paths.get(parent)}#set-${ra.data.gameId}`);
  }
  return paths;
}

/**
 * Square art per game slug, for lists and sidebars where a 3:4 cover has to be cropped to fit.
 * Your own `icon` wins; otherwise the RetroAchievements icon of the linked game, which covers most
 * of the library for free. Games with neither are absent, and the caller falls back to initials.
 */
export async function gameIcons(games: Game[]): Promise<Map<string, string>> {
  const linked = games.filter((g) => !g.data.icon && g.data.raGameId);
  const raIcons = new Map<number, string>();
  if (linked.length) {
    for (const entry of await getCollection('raGames')) {
      if (entry.data.imageIcon) raIcons.set(entry.data.gameId, entry.data.imageIcon);
    }
  }
  const icons = new Map<string, string>();
  for (const game of games) {
    const own = game.data.icon;
    const fromRa = game.data.raGameId ? raIcons.get(game.data.raGameId) : undefined;
    const src = own || fromRa;
    if (src) icons.set(game.id, src);
  }
  return icons;
}

export type GameProgress = { done: number; total: number; pct: number };

/**
 * Achievement progress per game slug, from the RetroAchievements snapshot of the linked game.
 * Games with no RA link, or a set with no achievements, are absent rather than shown as 0%.
 */
export async function gameProgress(games: Game[]): Promise<Map<string, GameProgress>> {
  const linked = games.filter((g) => g.data.raGameId);
  if (!linked.length) return new Map();
  const snapshots = new Map<number, { numAwarded: number; numAchievements: number }>();
  for (const entry of await getCollection('raGames')) {
    snapshots.set(entry.data.gameId, { numAwarded: entry.data.numAwarded, numAchievements: entry.data.numAchievements });
  }
  const progress = new Map<string, GameProgress>();
  for (const game of linked) {
    const snap = snapshots.get(game.data.raGameId!);
    if (!snap?.numAchievements) continue;
    progress.set(game.id, {
      done: snap.numAwarded,
      total: snap.numAchievements,
      pct: Math.round((snap.numAwarded / snap.numAchievements) * 100),
    });
  }
  return progress;
}

/** The square icon for a single game - the sidebar case, where there is only ever one. */
export async function gameIconFor(game?: Game): Promise<string | undefined> {
  if (!game) return undefined;
  return (await gameIcons([game])).get(game.id);
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

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    // Same rule as the guide bodies: off-site links open in a new tab.
    link(token) {
      const href = escapeAttr(String(token.href ?? ''));
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
      const external = isExternalUrl(token.href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${title}${external}>${this.parser.parseInline(token.tokens)}</a>`;
    },
  },
});

export function renderMarkdown(source?: string): string {
  if (!source) return '';
  return marked.parse(source, { async: false }) as string;
}
