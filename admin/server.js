/**
 * QuestLog local admin.
 *
 * Runs ONLY on your machine (binds to 127.0.0.1) and edits the JSON / Markdown files that the
 * public Astro site is built from. Nothing here is deployed: Vercel just runs `astro build`.
 *
 *   npm run admin   ->  http://127.0.0.1:3333
 */
import { readFile, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { serve } from '@hono/node-server';

import { PATHS } from './lib/paths.js';
import { HttpError, badRequest, notFound, conflict } from './lib/errors.js';
import { slugify, isSlug } from './lib/slug.js';
import * as store from './lib/store.js';
import * as git from './lib/git.js';
import * as ra from './lib/ra.js';
import * as steam from './lib/steam.js';
import * as shelf from './lib/shelf.js';
import * as attachments from './lib/attachments.js';
import { GameSchema, GuideSchema, TrackerSchema, SiteSchema, PlatformSchema, AchievementSetSchema, validate, ensureTrackerItemIds, ensureAchievementIds } from './lib/schemas.js';
import { STATUSES, OWNERSHIP, GUIDE_TYPE_SUGGESTIONS, TRACKER_TYPES, raImage } from '../src/lib/constants.js';
import { z } from 'zod';

/* ---------------- environment ---------------- */

if (existsSync(PATHS.env)) {
  try {
    process.loadEnvFile(PATHS.env);
  } catch (err) {
    console.warn(`Could not read .env: ${err.message}`);
  }
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT) || 3333;
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];

/* ---------------- app ---------------- */

const app = new Hono();

// Refuse anything that isn't addressed to this machine (DNS-rebinding guard).
app.use('*', async (c, next) => {
  const host = (c.req.header('host') ?? '').split(':')[0];
  if (host !== 'localhost' && host !== '127.0.0.1') return c.text('Forbidden', 403);
  await next();
});

// Block cross-site form posts. JSON calls are already protected by the lack of CORS headers.
app.use('/api/*', csrf({ origin: ORIGINS }));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, details: err.details ?? null }, err.status);
  if (err instanceof HTTPException) return c.json({ error: err.message || 'Request blocked' }, err.status);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, 500);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

/* ---------------- meta ---------------- */

app.get('/api/meta', async (c) => {
  const [site, platforms] = await Promise.all([store.getSite(), store.getPlatforms()]);
  const config = ra.raConfig();
  return c.json({
    statuses: STATUSES,
    ownership: OWNERSHIP,
    guideTypes: GUIDE_TYPE_SUGGESTIONS,
    trackerTypes: TRACKER_TYPES,
    platforms,
    site,
    ra: { configured: config.configured, username: config.username },
    steam: { configured: steam.steamConfig().configured },
    port: PORT,
  });
});

app.get('/api/dashboard', async (c) => {
  const [games, guides, trackers, profile, gitStatus] = await Promise.all([
    store.listGames(),
    store.listGuides(),
    store.listTrackers(),
    store.getRaProfile(),
    git.status().catch((err) => ({ error: err.message })),
  ]);
  const owned = games.filter((g) => g.ownership === 'owned');
  return c.json({
    games: {
      total: games.length,
      owned: owned.length,
      wishlist: games.length - owned.length,
      playing: owned.filter((g) => g.status === 'playing').length,
      linked: games.filter((g) => g.raGameId).length,
      byStatus: Object.fromEntries(STATUSES.map((s) => [s.id, owned.filter((g) => g.status === s.id).length])),
    },
    guides: guides.length,
    trackers: trackers.length,
    ra: { syncedAt: profile.syncedAt, points: profile.points, user: profile.user, configured: ra.raConfig().configured },
    git: gitStatus,
    recentGames: [...games].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8),
  });
});

/* ---------------- games ---------------- */

app.get('/api/games', async (c) => c.json(await store.listGames()));

app.get('/api/games/:slug', async (c) => c.json(await store.getGame(c.req.param('slug'))));

app.post('/api/games', async (c) => {
  const body = await c.req.json();
  const data = validate(GameSchema, body);
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : slugify(data.title);
  if (!isSlug(requested)) throw badRequest('Slug may only contain lowercase letters, numbers and dashes');
  if (await store.gameExists(requested)) throw conflict(`A game with slug "${requested}" already exists`);
  await assertPlatformExists(data.platform);
  const timestamp = store.now();
  const game = await store.saveGame(requested, { ...data, addedAt: timestamp, updatedAt: timestamp });
  return c.json(game, 201);
});

app.put('/api/games/:slug', async (c) => {
  const slug = c.req.param('slug');
  const existing = await store.getGame(slug);
  const data = validate(GameSchema, await c.req.json());
  await assertPlatformExists(data.platform);
  const game = await store.saveGame(slug, { ...data, addedAt: existing.addedAt ?? store.now(), updatedAt: store.now() });
  return c.json(game);
});

app.delete('/api/games/:slug', async (c) => {
  const slug = c.req.param('slug');
  const game = await store.getGame(slug);
  const refs = await store.referencesToGame(slug);
  if (refs.guides.length || refs.trackers.length || refs.sets.length) {
    throw conflict(`"${game.title}" is still referenced by ${[...refs.guides, ...refs.trackers, ...refs.sets].join(', ')}. Unlink or delete those first.`);
  }
  await store.deleteGame(slug);
  for (const kind of Object.values(IMAGE_KINDS)) await removeLocalImage(kind, slug);
  if (game.raGameId) await store.deleteRaGame(game.raGameId);
  return c.json({ ok: true });
});

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The two pieces of art a game can have: the 3:4 cover, and the square icon used in lists. */
const IMAGE_KINDS = {
  cover: { label: 'Cover', dir: PATHS.covers, urlBase: '/covers', field: 'cover' },
  icon: { label: 'Icon', dir: PATHS.icons, urlBase: '/icons', field: 'icon' },
};

async function removeLocalImage(kind, slug) {
  for (const ext of Object.values(IMAGE_TYPES)) {
    const file = path.join(kind.dir, `${slug}.${ext}`);
    if (existsSync(file)) await unlink(file);
  }
}

async function storeImage(kind, slug, bytes, mime) {
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw badRequest(`Unsupported image type "${mime}". Use PNG, JPEG, WebP or GIF.`);
  if (bytes.length > MAX_IMAGE_BYTES) throw badRequest(`${kind.label} is larger than 8 MB`);
  await mkdir(kind.dir, { recursive: true });
  await removeLocalImage(kind, slug);
  await writeFile(path.join(kind.dir, `${slug}.${ext}`), bytes);
  const game = await store.getGame(slug);
  return store.saveGame(slug, { ...game, [kind.field]: `${kind.urlBase}/${slug}.${ext}`, updatedAt: store.now() });
}

/** Fetches a remote image so the site never depends on a third-party host staying up. */
async function downloadImage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('Only http(s) URLs are allowed');
  const res = await fetch(parsed, { headers: { 'User-Agent': 'huntthepast-questlog-admin/1.0' } });
  if (!res.ok) throw badRequest(`Could not download image (HTTP ${res.status})`);
  return { mime: (res.headers.get('content-type') ?? '').split(';')[0].trim(), bytes: Buffer.from(await res.arrayBuffer()) };
}

// Upload (multipart/form-data, field "file") or pull a remote image into public/, for both kinds of art.
for (const [name, kind] of Object.entries(IMAGE_KINDS)) {
  app.post(`/api/games/:slug/${name}`, async (c) => {
    const slug = c.req.param('slug');
    await store.getGame(slug);
    const file = (await c.req.parseBody()).file;
    if (!(file instanceof File)) throw badRequest('Send the image as a multipart field named "file"');
    return c.json(await storeImage(kind, slug, Buffer.from(await file.arrayBuffer()), file.type));
  });

  app.post(`/api/games/:slug/${name}-from-url`, async (c) => {
    const slug = c.req.param('slug');
    await store.getGame(slug);
    const { url } = await c.req.json();
    const { mime, bytes } = await downloadImage(url);
    return c.json(await storeImage(kind, slug, bytes, mime));
  });
}

async function assertPlatformExists(id) {
  const platforms = await store.getPlatforms();
  if (!platforms.some((p) => p.id === id)) throw badRequest(`Unknown platform "${id}". Add it under Settings first.`);
}

/* ---------------- guides ---------------- */

app.get('/api/guides', async (c) => c.json(await store.listGuides()));
app.get('/api/guides/:slug', async (c) => c.json(await store.getGuide(c.req.param('slug'))));

app.post('/api/guides', async (c) => {
  const body = await c.req.json();
  const { body: markdown, ...data } = validate(GuideSchema, body);
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : slugify(data.title);
  if (!isSlug(requested)) throw badRequest('Slug may only contain lowercase letters, numbers and dashes');
  if (await store.guideExists(requested)) throw conflict(`A guide with slug "${requested}" already exists`);
  await assertGameRef(data.game);
  const timestamp = store.now();
  return c.json(await store.saveGuide(requested, { ...data, createdAt: timestamp, updatedAt: timestamp }, markdown), 201);
});

app.put('/api/guides/:slug', async (c) => {
  const slug = c.req.param('slug');
  const existing = await store.getGuide(slug);
  const raw = await c.req.json();
  const { body: markdown, ...data } = validate(GuideSchema, raw);
  await assertGameRef(data.game);
  return c.json(await store.saveGuide(slug, { ...keepUnsent(raw, data, existing, GUIDE_LISTS), createdAt: existing.createdAt ?? store.now(), updatedAt: store.now() }, markdown));
});

app.delete('/api/guides/:slug', async (c) => {
  const slug = c.req.param('slug');
  await store.deleteGuide(slug);
  await attachments.removeAll(slug);
  return c.json({ ok: true });
});


/*
 * Lists whose schema default is [], which makes an *omitted* field indistinguishable from an
 * emptied one - and a save that never mentioned a field must not silently erase it. That happens
 * for real: an admin tab left open across a code change keeps posting the shape it was loaded with,
 * so a field added since would be wiped on the next save of any page.
 *
 * Sending the key explicitly still clears it; only leaving it out falls back to what is on disk.
 */
const GUIDE_LISTS = ['gallery', 'downloads', 'sources', 'tags'];
const TRACKER_LISTS = ['sections', 'sources'];

function keepUnsent(raw, data, existing, keys) {
  const merged = { ...data };
  for (const key of keys) {
    if (!(key in raw) && existing[key] !== undefined) merged[key] = existing[key];
  }
  return merged;
}

async function assertGameRef(slug) {
  if (slug && !(await store.gameExists(slug))) throw badRequest(`Linked game "${slug}" does not exist`);
}

/* ---- guide attachments (images in public/guides/<slug>/) ---- */

app.get('/api/guides/:slug/attachments', async (c) => {
  const slug = c.req.param('slug');
  await store.getGuide(slug);
  return c.json(await attachments.list(slug));
});

// Upload one or more images (multipart/form-data, field "files").
app.post('/api/guides/:slug/attachments', async (c) => {
  const slug = c.req.param('slug');
  await store.getGuide(slug);
  const body = await c.req.parseBody({ all: true });
  const raw = body.files ?? body.file;
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f) => f instanceof File);
  if (!files.length) throw badRequest('Send images as multipart fields named "files"');
  const added = [];
  for (const file of files) added.push(await attachments.add(slug, file));
  return c.json({ added, files: await attachments.list(slug) }, 201);
});

app.delete('/api/guides/:slug/attachments/:name', async (c) => {
  const slug = c.req.param('slug');
  await attachments.remove(slug, c.req.param('name'));
  return c.json({ files: await attachments.list(slug) });
});

// Zip of the gallery (or of every attachment) to attach to a GitHub release.
app.get('/api/guides/:slug/gallery.zip', async (c) => {
  const slug = c.req.param('slug');
  const guide = await store.getGuide(slug);
  const names = (guide.gallery ?? []).map((g) => path.basename(String(g.src)));
  const bytes = await attachments.zip(slug, names);
  return c.body(bytes, 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug}-gallery.zip"`,
  });
});

// Headings of a guide (for linking to another guide's section). Slugs follow github-slugger,
// which is what Astro uses for heading ids.
app.get('/api/guides/:slug/headings', async (c) => {
  const guide = await store.getGuide(c.req.param('slug'));
  return c.json(headingsOf(guide.body ?? ''));
});

function headingsOf(markdown) {
  const seen = new Map();
  const headings = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[2].replace(/[*_`~]/g, '').trim();
    let slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;
    headings.push({ depth: match[1].length, text, slug });
  }
  return headings;
}

/* ---------------- trackers ---------------- */

app.get('/api/trackers', async (c) => c.json(await store.listTrackers()));
app.get('/api/trackers/:slug', async (c) => c.json(await store.getTracker(c.req.param('slug'))));

app.post('/api/trackers', async (c) => {
  const body = await c.req.json();
  const data = validate(TrackerSchema, body);
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : slugify(data.title);
  if (!isSlug(requested)) throw badRequest('Slug may only contain lowercase letters, numbers and dashes');
  if (await store.trackerExists(requested)) throw conflict(`A tracker with slug "${requested}" already exists`);
  await assertGameRef(data.game);
  const timestamp = store.now();
  const tracker = { ...data, sections: ensureTrackerItemIds(data.sections), createdAt: timestamp, updatedAt: timestamp };
  return c.json(await store.saveTracker(requested, tracker), 201);
});

app.put('/api/trackers/:slug', async (c) => {
  const slug = c.req.param('slug');
  const existing = await store.getTracker(slug);
  const raw = await c.req.json();
  const data = keepUnsent(raw, validate(TrackerSchema, raw), existing, TRACKER_LISTS);
  await assertGameRef(data.game);
  const tracker = { ...data, sections: ensureTrackerItemIds(data.sections), createdAt: existing.createdAt ?? store.now(), updatedAt: store.now() };
  return c.json(await store.saveTracker(slug, tracker));
});

app.delete('/api/trackers/:slug', async (c) => {
  await store.deleteTracker(c.req.param('slug'));
  return c.json({ ok: true });
});

/* ---------------- sources (credits, across guides and trackers) ---------------- */

/**
 * Every source credited anywhere, grouped by the name being credited and carrying the pages that
 * cite it. Mirrors allSources() on the site so the admin list and /credits agree. Grouping ignores
 * the URL on purpose: one site gets cited through different deep links and is still one source.
 */
app.get('/api/sources', async (c) => {
  const [guides, trackers] = await Promise.all([store.listGuides(), store.listTrackers()]);
  const pages = [
    ...guides.map((g) => ({ kind: 'guide', slug: g.slug, title: g.title, sources: g.sources ?? [] })),
    ...trackers.map((t) => ({ kind: 'tracker', slug: t.slug, title: t.title, sources: t.sources ?? [] })),
  ];

  const grouped = new Map();
  for (const page of pages) {
    for (const source of page.sources) {
      const key = String(source.label ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) continue;
      const entry = grouped.get(key) ?? { label: source.label, url: '', note: '', license: '', urls: [], pages: [] };
      // The first mention sets the shared fields; later ones only fill in what is still blank.
      entry.url ||= source.url ?? '';
      entry.license ||= source.license ?? '';
      entry.note ||= source.note ?? '';
      if (source.url && !entry.urls.includes(source.url)) entry.urls.push(source.url);
      entry.pages.push({ kind: page.kind, slug: page.slug, title: page.title, url: source.url ?? '', note: source.note ?? '' });
      grouped.set(key, entry);
    }
  }
  return c.json([...grouped.values()].sort((a, b) => a.label.localeCompare(b.label)));
});

/* ---------------- settings ---------------- */

app.get('/api/site', async (c) => c.json(await store.getSite()));

app.put('/api/site', async (c) => {
  const data = validate(SiteSchema, await c.req.json());
  await store.saveSite(data);
  return c.json(data);
});

app.get('/api/platforms', async (c) => c.json(await store.getPlatforms()));

app.put('/api/platforms', async (c) => {
  const list = validate(z.array(PlatformSchema), await c.req.json());
  const ids = new Set();
  for (const p of list) {
    if (ids.has(p.id)) throw badRequest(`Duplicate platform id "${p.id}"`);
    ids.add(p.id);
  }
  // Never orphan a game by removing the platform it points at.
  const inUse = new Set((await store.listGames()).map((g) => g.platform));
  const missing = [...inUse].filter((id) => !ids.has(id));
  if (missing.length) throw conflict(`Platforms still used by games cannot be removed: ${missing.join(', ')}`);
  await store.savePlatforms(list);
  return c.json(list);
});

/* ---------------- RetroAchievements ---------------- */

app.get('/api/ra/status', async (c) => {
  const profile = await store.getRaProfile();
  const linked = (await store.listGames()).filter((g) => g.raGameId).length;
  const { configured, username } = ra.raConfig();
  return c.json({ config: { configured, username }, profile: { syncedAt: profile.syncedAt, user: profile.user, points: profile.points, rank: profile.rank, stats: profile.stats, completionCount: profile.completion?.length ?? 0 }, linkedGames: linked, job: ra.syncStatus() });
});

app.post('/api/ra/sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(ra.startSync({ autoStatus: Boolean(body.autoStatus), autoHours: body.autoHours !== false, autoDates: body.autoDates !== false }), 202);
});

app.get('/api/ra/sync/status', (c) => c.json(ra.syncStatus()));

// Look up a game on RA to pre-fill the game form.
app.get('/api/ra/game/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid RA game id');
  const { username, apiKey } = ra.raConfig();
  const client = new ra.RaClient({ username, apiKey });
  const info = await client.getGame(id);
  if (!info || !info.Title) throw notFound(`RA game #${id} not found`);
  const { title, tag } = ra.splitRaTitle(info.Title);
  const platform = ra.platformForConsole(await store.getPlatforms(), info.ConsoleID, info.ConsoleName);
  return c.json({
    raGameId: id,
    title,
    tag,
    consoleId: info.ConsoleID,
    consoleName: info.ConsoleName,
    platform: platform?.id ?? null,
    cover: raImage(info.ImageBoxArt),
    imageIcon: raImage(info.ImageIcon),
    developer: info.Developer || '',
    publisher: info.Publisher || '',
    genres: String(info.Genre ?? '').split(/[,/]/).map((s) => s.trim()).filter(Boolean),
    releaseYear: ra.releaseYearFrom(info.Released) ?? '',
  });
});

app.get('/api/ra/import-candidates', async (c) => c.json(await ra.importCandidates()));

app.post('/api/ra/import', async (c) => {
  const body = await c.req.json();
  const games = Array.isArray(body.games) ? body.games : [];
  if (!games.length) throw badRequest('Select at least one game');
  return c.json(await ra.importGames(games));
});

app.post('/api/ra/consoles', async (c) => c.json(await ra.importConsoles()));

// Subsets that were imported as separate library games -> fold them into their main game's page.
app.get('/api/ra/subsets', async (c) => c.json(await ra.subsetEntries()));

// The subsets attached to one main game (for the per-subset journal in the game editor).
app.get('/api/ra/subsets-of/:id', async (c) => c.json(await ra.subsetsOf(c.req.param('id'))));

app.post('/api/ra/subsets/merge', async (c) => {
  const body = await c.req.json();
  if (typeof body.slug !== 'string' || !body.slug) throw badRequest('Missing slug');
  return c.json(await ra.mergeSubset(body.slug));
});

/* ---------------- achievement sets (Steam sync + manual) ---------------- */

app.get('/api/sets', async (c) => c.json(await store.listSets()));
app.get('/api/sets/:slug', async (c) => c.json(await store.getSet(c.req.param('slug'))));

app.post('/api/sets', async (c) => {
  const body = await c.req.json();
  const data = validate(AchievementSetSchema, body);
  data.achievements = ensureAchievementIds(data.achievements);
  if (!(await store.gameExists(data.game))) throw badRequest(`Unknown game "${data.game}"`);
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : `${data.game}-${slugify(data.title)}`;
  if (!isSlug(requested)) throw badRequest('Slug may only contain lowercase letters, numbers and dashes');
  if (await store.setExists(requested)) throw conflict(`An achievement set with slug "${requested}" already exists`);
  const timestamp = store.now();
  return c.json(await store.saveSet(requested, { ...data, createdAt: timestamp, updatedAt: timestamp }), 201);
});

app.put('/api/sets/:slug', async (c) => {
  const slug = c.req.param('slug');
  const existing = await store.getSet(slug);
  const data = validate(AchievementSetSchema, await c.req.json());
  data.achievements = ensureAchievementIds(data.achievements);
  if (!(await store.gameExists(data.game))) throw badRequest(`Unknown game "${data.game}"`);
  return c.json(await store.saveSet(slug, { ...existing, ...data, createdAt: existing.createdAt ?? store.now(), updatedAt: store.now() }));
});

app.delete('/api/sets/:slug', async (c) => {
  await store.deleteSet(c.req.param('slug'));
  return c.json({ ok: true });
});

/* ---------------- Steam ---------------- */

app.get('/api/steam/status', (c) => c.json({ configured: steam.steamConfig().configured, job: steam.syncStatus() }));

app.post('/api/steam/sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(steam.startSync({ autoStatus: Boolean(body.autoStatus), autoHours: body.autoHours !== false, autoDates: body.autoDates !== false }), 202);
});

app.get('/api/steam/sync/status', (c) => c.json(steam.syncStatus()));
app.get('/api/steam/import-candidates', async (c) => c.json(await steam.importCandidates()));

app.post('/api/steam/import', async (c) => {
  const body = await c.req.json();
  const games = Array.isArray(body.games) ? body.games : [];
  if (!games.length) throw badRequest('Select at least one game');
  return c.json(await steam.importGames(games));
});

// Store metadata for the game editor's "Fetch" button and the achievement list for manual sets.
app.get('/api/steam/app/:id', async (c) => c.json(await steam.appDetails(c.req.param('id'))));
app.get('/api/steam/schema/:id', async (c) => c.json(await steam.schemaFor(c.req.param('id'))));

// Trophy shelf: RA order by default, manual order/hidden list stored in src/data/shelf.json.
app.get('/api/shelf', async (c) => c.json(await shelf.shelfState()));
app.put('/api/shelf', async (c) => c.json(await shelf.saveShelf(await c.req.json())));

/* ---------------- git / publish ---------------- */

app.get('/api/git/status', async (c) => c.json(await git.status()));

app.post('/api/git/publish', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await git.publish(body.message));
});

app.post('/api/build', async (c) => c.json(await git.testBuild()));

/* ---------------- static files ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function sendFile(c, file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) throw notFound();
  } catch {
    throw notFound();
  }
  const body = await readFile(file);
  return c.body(body, 200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
}

// Vendored libraries served straight from node_modules so the admin works offline.
const VENDOR = {
  'alpine.js': path.join(PATHS.nodeModules, 'alpinejs', 'dist', 'cdn.min.js'),
  'marked.js': path.join(PATHS.nodeModules, 'marked', 'lib', 'marked.umd.js'),
  'sweetalert2.js': path.join(PATHS.nodeModules, 'sweetalert2', 'dist', 'sweetalert2.min.js'),
  // Shared with the public site so both look the same (see src/lib/dialogs.js).
  'dialogs.js': path.join(PATHS.root, 'src', 'lib', 'dialogs.js'),
};
app.get('/vendor/:name', (c) => {
  const file = VENDOR[c.req.param('name')];
  if (!file) throw notFound();
  return sendFile(c, file);
});
app.get('/vendor/fonts/:name', (c) => {
  const name = path.basename(c.req.param('name'));
  return sendFile(c, path.join(PATHS.nodeModules, '@fontsource-variable', 'pixelify-sans', 'files', name));
});

// Icon previews (the site serves these from /icons on Vercel).
app.get('/icons/:name', (c) => {
  const name = path.basename(c.req.param('name'));
  return sendFile(c, path.join(PATHS.icons, name));
});

// Cover previews (the site serves these from /covers on Vercel).
app.get('/covers/:name', (c) => {
  const name = path.basename(c.req.param('name'));
  return sendFile(c, path.join(PATHS.covers, name));
});

// Guide attachments (the site serves these from /guides/<slug>/ on Vercel).
app.get('/guides/:slug/:name', (c) => {
  const slug = c.req.param('slug');
  if (!isSlug(slug)) throw notFound();
  return sendFile(c, path.join(PATHS.public, 'guides', slug, path.basename(c.req.param('name'))));
});

// The site's favicon, reused for the admin tab.
app.get('/favicon.svg', (c) => sendFile(c, path.join(PATHS.root, 'public', 'favicon.svg')));

app.get('/*', (c) => {
  const requested = decodeURIComponent(new URL(c.req.url).pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const file = path.resolve(PATHS.adminPublic, relative);
  if (!file.startsWith(PATHS.adminPublic)) throw notFound();
  return sendFile(c, file);
});

/* ---------------- start ---------------- */

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  const config = ra.raConfig();
  console.log('');
  console.log(`  QuestLog admin  ->  http://${info.address}:${info.port}`);
  console.log(`  Repo            ->  ${PATHS.root}`);
  console.log(`  RetroAchievements: ${config.configured ? `configured for ${config.username}` : 'not configured (copy .env.example to .env)'}`);
  console.log('  This server only listens on 127.0.0.1 and is never deployed.');
  console.log('');
});
