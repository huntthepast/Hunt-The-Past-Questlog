import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute paths used by the admin. Everything is resolved from the repo root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  root: ROOT,
  admin: path.join(ROOT, 'admin'),
  adminPublic: path.join(ROOT, 'admin', 'public'),
  nodeModules: path.join(ROOT, 'node_modules'),
  games: path.join(ROOT, 'src', 'content', 'games'),
  guides: path.join(ROOT, 'src', 'content', 'guides'),
  trackers: path.join(ROOT, 'src', 'content', 'trackers'),
  raGames: path.join(ROOT, 'src', 'content', 'ra-games'),
  site: path.join(ROOT, 'src', 'data', 'site.json'),
  platforms: path.join(ROOT, 'src', 'data', 'platforms.json'),
  raProfile: path.join(ROOT, 'src', 'data', 'ra-profile.json'),
  shelf: path.join(ROOT, 'src', 'data', 'shelf.json'),
  public: path.join(ROOT, 'public'),
  covers: path.join(ROOT, 'public', 'covers'),
  env: path.join(ROOT, '.env'),
};
