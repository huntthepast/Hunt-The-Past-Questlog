// Shared vocabulary used by BOTH the public site (Astro) and the local admin.
// Keep this file plain JavaScript so Node can import it without a build step.

/** Progress statuses, in display order (GameFAQs-style). */
export const STATUSES = [
  { id: 'unplayed',  label: 'Not Started', short: 'Backlog',  color: 'zinc',    played: false, done: false, description: 'In the library, never booted.' },
  { id: 'playing',   label: 'Playing',     short: 'Playing',  color: 'sky',     played: true,  done: false, description: 'Currently working through it.' },
  { id: 'on-hold',   label: 'On Hold',     short: 'On Hold',  color: 'orange',  played: true,  done: false, description: 'Paused, plan to come back.' },
  { id: 'played',    label: 'Played',      short: 'Played',   color: 'teal',    played: true,  done: false, description: 'Spent real time with it, no clear ending reached.' },
  { id: 'beaten',    label: 'Beaten',      short: 'Beaten',   color: 'emerald', played: true,  done: true,  description: 'Rolled credits on the main story.' },
  { id: 'completed', label: 'Completed',   short: 'Complete', color: 'violet',  played: true,  done: true,  description: 'Finished everything worth finishing.' },
  { id: 'mastered',  label: 'Mastered',    short: 'Mastered', color: 'amber',   played: true,  done: true,  description: 'Every achievement / 100% - nothing left.' },
  { id: 'dropped',   label: 'Dropped',     short: 'Dropped',  color: 'rose',    played: true,  done: false, description: 'Stopped and not coming back.' },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);

export const OWNERSHIP = [
  { id: 'owned',    label: 'In library' },
  { id: 'wishlist', label: 'Wishlist' },
];

export const OWNERSHIP_IDS = OWNERSHIP.map((o) => o.id);

export const STEAM_STORE = 'https://store.steampowered.com';
export const steamStoreUrl = (appId) => `${STEAM_STORE}/app/${appId}`;
/** Steam's portrait library art (falls back to the wide header image on the site when missing). */
export const steamCoverUrl = (appId) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
export const steamHeaderUrl = (appId) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

/**
 * What kind of release a game is. RetroAchievements marks non-official sets with a title prefix
 * ("~Hack~ Title", "~Homebrew~ Title"); the import keeps that prefix as a tag, and the tag decides
 * the kind here. A game without any of these tags is an official release.
 */
export const GAME_KINDS = [
  { id: 'official',   label: 'Official' },
  { id: 'hack',       label: 'Hack' },
  { id: 'homebrew',   label: 'Homebrew' },
  { id: 'prototype',  label: 'Prototype' },
  { id: 'demo',       label: 'Demo' },
  { id: 'unlicensed', label: 'Unlicensed' },
  { id: 'test-kit',   label: 'Test kit' },
];

/** The kind a game's tags put it in ("official" when none of the kind tags is present). */
export function gameKindOf(tags = []) {
  const ids = tags.map((t) => String(t).toLowerCase());
  return GAME_KINDS.find((k) => k.id !== 'official' && ids.includes(k.id))?.id ?? 'official';
}

/**
 * Guide types are free text (GameFAQs-style: Walkthrough, Maps, Items, Persona List, ...).
 * These are only suggestions for the admin's dropdown; anything else is allowed.
 */
export const GUIDE_TYPE_SUGGESTIONS = [
  'Walkthrough', 'Maps', 'Items', 'Equipment', 'Weapons', 'Characters', 'Bosses', 'Enemies',
  'Mini-games', 'Side Quests', 'Cheats & Codes', 'Tips & Tricks', 'Collectibles', 'Missables', 'FAQ', 'Review', 'Notes',
];

/* Known types get a fixed colour and a position in per-game navigation (lower = earlier). */
const GUIDE_TYPE_STYLE = {
  walkthrough: { color: 'sky', weight: 0 },
  walkthroughs: { color: 'sky', weight: 0 },
  maps: { color: 'emerald', weight: 1 },
  map: { color: 'emerald', weight: 1 },
  characters: { color: 'orange', weight: 2 },
  party: { color: 'orange', weight: 2 },
  items: { color: 'violet', weight: 3 },
  'item list': { color: 'violet', weight: 3 },
  equipment: { color: 'violet', weight: 3 },
  weapons: { color: 'violet', weight: 3 },
  armor: { color: 'violet', weight: 3 },
  bosses: { color: 'rose', weight: 4 },
  'boss guide': { color: 'rose', weight: 4 },
  enemies: { color: 'orange', weight: 4 },
  bestiary: { color: 'orange', weight: 4 },
  'mini-games': { color: 'teal', weight: 5 },
  minigames: { color: 'teal', weight: 5 },
  'side quests': { color: 'sky', weight: 5 },
  sidequests: { color: 'sky', weight: 5 },
  collectibles: { color: 'violet', weight: 5 },
  missables: { color: 'rose', weight: 5 },
  'cheats & codes': { color: 'rose', weight: 6 },
  cheats: { color: 'rose', weight: 6 },
  'tips & tricks': { color: 'emerald', weight: 6 },
  tips: { color: 'emerald', weight: 6 },
  faq: { color: 'zinc', weight: 8 },
  review: { color: 'amber', weight: 9 },
  notes: { color: 'zinc', weight: 10 },
};

const GUIDE_TYPE_PALETTE = ['sky', 'emerald', 'violet', 'orange', 'teal', 'rose', 'amber'];

/** Grouping key for a type label: case- and whitespace-insensitive. */
export const normalizeGuideType = (label) => String(label ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Style info for any type label. Unknown labels get a stable colour picked from the palette. */
export function guideType(label) {
  const text = String(label ?? '').trim() || 'Notes';
  const id = normalizeGuideType(text);
  const known = GUIDE_TYPE_STYLE[id];
  if (known) return { id, label: text, ...known };
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { id, label: text, color: GUIDE_TYPE_PALETTE[hash % GUIDE_TYPE_PALETTE.length], weight: 7 };
}

/** Kinds of checklists (trackers). */
export const TRACKER_TYPES = [
  { id: 'missables',    label: 'Missables',    color: 'rose' },
  { id: 'collectibles', label: 'Collectibles', color: 'violet' },
  { id: 'sidequests',   label: 'Side Quests',  color: 'sky' },
  { id: 'achievements', label: 'Achievements', color: 'amber' },
  { id: 'bosses',       label: 'Bosses',       color: 'orange' },
  { id: 'checklist',    label: 'Checklist',    color: 'emerald' },
];

export const TRACKER_TYPE_IDS = TRACKER_TYPES.map((t) => t.id);

/** Lookup helpers (always return something so templates never crash). */
export const statusById = (id) => STATUSES.find((s) => s.id === id) ?? STATUSES[0];
export const trackerTypeById = (id) => TRACKER_TYPES.find((t) => t.id === id) ?? TRACKER_TYPES[TRACKER_TYPES.length - 1];

/** RetroAchievements hosts. Image paths returned by the API are relative to RA_MEDIA. */
export const RA_SITE = 'https://retroachievements.org';
export const RA_MEDIA = 'https://media.retroachievements.org';

export const raImage = (path) => {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return RA_MEDIA + (path.startsWith('/') ? path : '/' + path);
};

/** Maps a RetroAchievements award kind to one of our statuses. */
export const statusFromAwardKind = (kind, numAwarded = 0) => {
  switch (kind) {
    case 'mastered':
      return 'mastered';
    case 'completed':
      return 'completed';
    case 'beaten-hardcore':
    case 'beaten-softcore':
      return 'beaten';
    default:
      return numAwarded > 0 ? 'played' : 'unplayed';
  }
};
