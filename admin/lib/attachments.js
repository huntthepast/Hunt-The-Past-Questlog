import { readdir, stat, mkdir, writeFile, unlink, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { PATHS } from './paths.js';
import { badRequest, notFound } from './errors.js';
import { slugify, isSlug } from './slug.js';

/*
 * Guide attachments: images (maps, charts, screenshots) that live in public/guides/<slug>/ and are
 * served by the site at /guides/<slug>/<file>. They can be embedded in the Markdown body or listed
 * in the guide's gallery.
 */

export const ATTACHMENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const EXTENSIONS = new Set(Object.values(ATTACHMENT_TYPES));
const MAX_BYTES = 15 * 1024 * 1024;

const dirFor = (slug) => {
  if (!isSlug(slug)) throw badRequest(`Invalid slug "${slug}"`);
  return path.join(PATHS.public, 'guides', slug);
};

export const publicUrl = (slug, name) => `/guides/${slug}/${name}`;

/** Turns any upload name into a safe, unique file name inside the guide's folder. */
function safeName(dir, original, mime) {
  const ext = ATTACHMENT_TYPES[mime] ?? path.extname(original).slice(1).toLowerCase();
  if (!EXTENSIONS.has(ext)) throw badRequest(`Unsupported image type "${mime || ext}". Use PNG, JPEG, WebP, GIF or SVG.`);
  const base = slugify(path.basename(original, path.extname(original))) || 'image';
  let name = `${base}.${ext}`;
  let n = 2;
  while (existsSync(path.join(dir, name))) name = `${base}-${n++}.${ext}`;
  return name;
}

export async function list(slug) {
  const dir = dirFor(slug);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    if (!EXTENSIONS.has(ext)) continue;
    const info = await stat(path.join(dir, entry.name));
    files.push({ name: entry.name, url: publicUrl(slug, entry.name), size: info.size, modifiedAt: info.mtime.toISOString() });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function add(slug, file) {
  const dir = dirFor(slug);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw badRequest(`${file.name} is larger than 15 MB`);
  if (bytes.length === 0) throw badRequest(`${file.name} is empty`);
  await mkdir(dir, { recursive: true });
  const name = safeName(dir, file.name, file.type);
  await writeFile(path.join(dir, name), bytes);
  return { name, url: publicUrl(slug, name), size: bytes.length };
}

export async function remove(slug, name) {
  const dir = dirFor(slug);
  const file = path.join(dir, path.basename(name));
  if (!file.startsWith(dir) || !existsSync(file)) throw notFound(`Attachment "${name}" not found`);
  await unlink(file);
}

/** Deletes the whole folder (when the guide itself is deleted). */
export async function removeAll(slug) {
  const dir = dirFor(slug);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
}

/** Zip of the given file names (or every attachment when `names` is empty), for a GitHub release. */
export async function zip(slug, names = []) {
  const dir = dirFor(slug);
  const available = await list(slug);
  const wanted = names.length ? available.filter((f) => names.includes(f.name)) : available;
  if (!wanted.length) throw notFound('No attachments to zip');
  const entries = {};
  for (const file of wanted) entries[file.name] = new Uint8Array(await readFile(path.join(dir, file.name)));
  // Images are already compressed; store them as-is so the zip builds instantly.
  return Buffer.from(zipSync(entries, { level: 0 }));
}
