import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PATHS } from './paths.js';
import { notFound, badRequest } from './errors.js';
import { isSlug } from './slug.js';

/*
 * Everything the admin edits is a plain file inside the repo:
 *   src/content/games/<slug>.json      one game per file
 *   src/content/guides/<slug>.md       markdown with YAML frontmatter
 *   src/content/trackers/<slug>.json   checklists
 *   src/content/ra-games/<id>.json     RetroAchievements per-game snapshots
 *   src/data/site.json, platforms.json, ra-profile.json
 * Files are written with 2-space indent and a trailing newline so git diffs stay readable.
 */

export const now = () => new Date().toISOString();

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function listFiles(dir, ext) {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(ext) && !e.name.startsWith('_'))
    .map((e) => e.name.slice(0, -ext.length))
    .sort();
}

function assertSlug(slug) {
  if (!isSlug(slug)) throw badRequest(`Invalid slug "${slug}"`);
  return slug;
}

/* ---------------- games ---------------- */

const GAME_KEY_ORDER = [
  'title', 'platform', 'cover', 'icon', 'genres', 'developer', 'publisher', 'releaseYear',
  'ownership', 'favorite', 'status', 'rating', 'hoursPlayed', 'startedAt', 'finishedAt',
  'raGameId', 'steamAppId', 'subsets', 'review', 'notes', 'tags', 'addedAt', 'updatedAt',
];

/** Re-orders keys and drops undefined values so files look the same no matter who wrote them. */
function tidy(data, order) {
  const out = {};
  for (const key of order) if (data[key] !== undefined) out[key] = data[key];
  for (const key of Object.keys(data)) if (!(key in out) && data[key] !== undefined) out[key] = data[key];
  return out;
}

const gameFile = (slug) => path.join(PATHS.games, `${assertSlug(slug)}.json`);

export const gameExists = async (slug) => isSlug(slug) && existsSync(gameFile(slug));

export async function listGames() {
  const slugs = await listFiles(PATHS.games, '.json');
  const games = await Promise.all(slugs.map(async (slug) => ({ slug, ...(await readJson(gameFile(slug))) })));
  return games.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getGame(slug) {
  if (!(await gameExists(slug))) throw notFound(`Game "${slug}" not found`);
  return { slug, ...(await readJson(gameFile(slug))) };
}

export async function saveGame(slug, data) {
  const { slug: _ignored, ...rest } = data;
  await writeJson(gameFile(slug), tidy(rest, GAME_KEY_ORDER));
  return { slug, ...rest };
}

export async function deleteGame(slug) {
  if (!(await gameExists(slug))) throw notFound(`Game "${slug}" not found`);
  await unlink(gameFile(slug));
}

/* ---------------- guides (markdown + frontmatter) ---------------- */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseMarkdown(source) {
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: source };
  const data = YAML.parse(match[1]) ?? {};
  const body = source.slice(match[0].length).replace(/^\r?\n/, '');
  return { data, body };
}

export function stringifyMarkdown(data, body) {
  // Quote every string so timestamps like 2026-01-01T00:00:00Z are never re-parsed as dates.
  const front = YAML.stringify(data, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' }).trimEnd();
  return `---\n${front}\n---\n\n${body.replace(/\r\n/g, '\n').trimEnd()}\n`;
}

const GUIDE_KEY_ORDER = ['title', 'type', 'game', 'summary', 'version', 'order', 'series', 'checklistColumns', 'checklistCollapsed', 'tags', 'draft', 'gallery', 'downloads', 'sources', 'createdAt', 'updatedAt'];
const guideFile = (slug) => path.join(PATHS.guides, `${assertSlug(slug)}.md`);

export const guideExists = async (slug) => isSlug(slug) && existsSync(guideFile(slug));

export async function listGuides() {
  const slugs = await listFiles(PATHS.guides, '.md');
  const guides = await Promise.all(
    slugs.map(async (slug) => {
      const { data, body } = parseMarkdown(await readFile(guideFile(slug), 'utf8'));
      return { slug, ...data, bodyLength: body.length };
    }),
  );
  return guides.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

export async function getGuide(slug) {
  if (!(await guideExists(slug))) throw notFound(`Guide "${slug}" not found`);
  const { data, body } = parseMarkdown(await readFile(guideFile(slug), 'utf8'));
  return { slug, ...data, body };
}

export async function saveGuide(slug, data, body) {
  const { slug: _ignored, body: _body, bodyLength: _len, ...rest } = data;
  await mkdir(PATHS.guides, { recursive: true });
  await writeFile(guideFile(slug), stringifyMarkdown(tidy(rest, GUIDE_KEY_ORDER), body ?? ''), 'utf8');
  return { slug, ...rest, body };
}

export async function deleteGuide(slug) {
  if (!(await guideExists(slug))) throw notFound(`Guide "${slug}" not found`);
  await unlink(guideFile(slug));
}

/* ---------------- trackers ---------------- */

const TRACKER_KEY_ORDER = ['title', 'type', 'game', 'summary', 'checklistColumns', 'checklistCollapsed', 'sections', 'sources', 'createdAt', 'updatedAt'];
const trackerFile = (slug) => path.join(PATHS.trackers, `${assertSlug(slug)}.json`);

export const trackerExists = async (slug) => isSlug(slug) && existsSync(trackerFile(slug));

export async function listTrackers() {
  const slugs = await listFiles(PATHS.trackers, '.json');
  const trackers = await Promise.all(slugs.map(async (slug) => ({ slug, ...(await readJson(trackerFile(slug))) })));
  return trackers.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

export async function getTracker(slug) {
  if (!(await trackerExists(slug))) throw notFound(`Tracker "${slug}" not found`);
  return { slug, ...(await readJson(trackerFile(slug))) };
}

export async function saveTracker(slug, data) {
  const { slug: _ignored, ...rest } = data;
  await writeJson(trackerFile(slug), tidy(rest, TRACKER_KEY_ORDER));
  return { slug, ...rest };
}

export async function deleteTracker(slug) {
  if (!(await trackerExists(slug))) throw notFound(`Tracker "${slug}" not found`);
  await unlink(trackerFile(slug));
}

/* ---------------- achievement sets (Steam sync + manual) ---------------- */

const SET_KEY_ORDER = ['title', 'source', 'game', 'appId', 'url', 'playtimeMinutes', 'lastPlayedAt', 'syncedAt', 'journal', 'achievements', 'createdAt', 'updatedAt'];
const setFile = (slug) => path.join(PATHS.achievementSets, `${assertSlug(slug)}.json`);

export const setExists = async (slug) => isSlug(slug) && existsSync(setFile(slug));

export async function listSets() {
  const slugs = await listFiles(PATHS.achievementSets, '.json');
  const sets = await Promise.all(slugs.map(async (slug) => ({ slug, ...(await readJson(setFile(slug))) })));
  return sets.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

export async function getSet(slug) {
  if (!(await setExists(slug))) throw notFound(`Achievement set "${slug}" not found`);
  return { slug, ...(await readJson(setFile(slug))) };
}

export async function saveSet(slug, data) {
  const { slug: _ignored, ...rest } = data;
  await writeJson(setFile(slug), tidy(rest, SET_KEY_ORDER));
  return { slug, ...rest };
}

export async function deleteSet(slug) {
  if (!(await setExists(slug))) throw notFound(`Achievement set "${slug}" not found`);
  await unlink(setFile(slug));
}

/* ---------------- singletons ---------------- */

export const getSite = () => readJson(PATHS.site);
export const saveSite = (data) => writeJson(PATHS.site, data);

export const getPlatforms = () => readJson(PATHS.platforms);
export const savePlatforms = (data) => writeJson(PATHS.platforms, data);

export const getRaProfile = () => readJson(PATHS.raProfile);
export const saveRaProfile = (data) => writeJson(PATHS.raProfile, data);

/** Manual trophy-shelf overrides; missing file = follow RetroAchievements' order. */
export const getShelf = async () => (existsSync(PATHS.shelf) ? readJson(PATHS.shelf) : { order: [], hidden: [] });
export const saveShelf = (data) => writeJson(PATHS.shelf, data);

/* ---------------- RetroAchievements per-game snapshots ---------------- */

const raGameFile = (id) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid RA game id "${id}"`);
  return path.join(PATHS.raGames, `${n}.json`);
};

export async function listRaGameIds() {
  return (await listFiles(PATHS.raGames, '.json')).map(Number).filter((n) => Number.isInteger(n));
}

export const saveRaGame = (id, data) => writeJson(raGameFile(id), data);

export const getRaGame = async (id) => (existsSync(raGameFile(id)) ? readJson(raGameFile(id)) : null);

export async function deleteRaGame(id) {
  const file = raGameFile(id);
  if (existsSync(file)) await unlink(file);
}

/* ---------------- references ---------------- */

/** Which guides, trackers and achievement sets point at a game (used before deleting it). */
export async function referencesToGame(slug) {
  const [guides, trackers, sets] = await Promise.all([listGuides(), listTrackers(), listSets()]);
  return {
    guides: guides.filter((g) => g.game === slug).map((g) => g.slug),
    trackers: trackers.filter((t) => t.game === slug).map((t) => t.slug),
    sets: sets.filter((set) => set.game === slug).map((set) => set.slug),
  };
}
