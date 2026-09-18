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

/** Kinds of written content. `notes` is the catch-all for "other data". */
export const GUIDE_TYPES = [
  { id: 'walkthrough',  label: 'Walkthrough',    color: 'sky' },
  { id: 'cheats',       label: 'Cheats & Codes', color: 'rose' },
  { id: 'tips',         label: 'Tips & Tricks',  color: 'emerald' },
  { id: 'boss',         label: 'Boss Guide',     color: 'orange' },
  { id: 'collectibles', label: 'Collectibles',   color: 'violet' },
  { id: 'review',       label: 'Review',         color: 'amber' },
  { id: 'notes',        label: 'Notes',          color: 'zinc' },
];

export const GUIDE_TYPE_IDS = GUIDE_TYPES.map((t) => t.id);

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
export const guideTypeById = (id) => GUIDE_TYPES.find((t) => t.id === id) ?? GUIDE_TYPES[GUIDE_TYPES.length - 1];
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
