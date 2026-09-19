import { z } from 'zod';
import { STATUS_IDS, OWNERSHIP_IDS, TRACKER_TYPE_IDS } from '../../src/lib/constants.js';
import { badRequest } from './errors.js';
import { SLUG_RE, slugify } from './slug.js';

/*
 * These schemas mirror src/content.config.ts. The admin validates before writing so a bad
 * form submission can never produce a file that later breaks `astro build`.
 * Inputs arrive from HTML forms, so we normalise loosely-typed values first.
 */

const text = z.string().trim();
const optionalText = z.preprocess((v) => (v === '' || v === null ? undefined : v), text.optional());
const optionalNumber = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().optional());
const optionalInt = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().int().optional());
const optionalDate = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
);
const stringList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : []),
  z.array(z.string().trim().min(1)).transform((arr) => [...new Set(arr)]),
);
const bool = z.preprocess((v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1', z.boolean());
const slug = z.string().regex(SLUG_RE, 'Slug may only contain lowercase letters, numbers and dashes');
const optionalSlug = z.preprocess((v) => (v === '' || v === null ? undefined : v), slug.optional());

export const GameSchema = z.object({
  title: text.min(1, 'Title is required'),
  platform: slug,
  cover: optionalText,
  genres: stringList.default([]),
  developer: optionalText,
  publisher: optionalText,
  releaseYear: optionalInt.pipe(z.number().int().min(1950).max(2100).optional()),
  ownership: z.enum(OWNERSHIP_IDS).default('owned'),
  favorite: bool.default(false),
  status: z.enum(STATUS_IDS).default('unplayed'),
  rating: optionalNumber.pipe(z.number().min(0).max(10).optional()),
  hoursPlayed: optionalNumber.pipe(z.number().min(0).optional()),
  startedAt: optionalDate,
  finishedAt: optionalDate,
  raGameId: optionalInt.pipe(z.number().int().positive().optional()),
  review: optionalText,
  notes: optionalText,
  tags: stringList.default([]),
});

const GalleryItemSchema = z.object({
  src: text.min(1, 'Gallery image is missing its path'),
  title: text.min(1, 'Gallery image needs a title'),
  caption: optionalText,
});

const DownloadSchema = z.object({
  label: text.min(1, 'Download needs a label'),
  url: text.min(1, 'Download needs a URL'),
  note: optionalText,
});

export const GuideSchema = z.object({
  title: text.min(1, 'Title is required'),
  type: z.preprocess((v) => (v === '' || v === null ? undefined : v), text.min(1).default('Notes')),
  game: optionalSlug,
  summary: optionalText,
  version: optionalText,
  order: z.preprocess((v) => (v === '' || v === null || v === undefined ? 0 : Number(v)), z.number().int().default(0)),
  tags: stringList.default([]),
  draft: bool.default(false),
  gallery: z.array(GalleryItemSchema).default([]),
  downloads: z.array(DownloadSchema).default([]),
  body: z.string().default(''),
});

const TrackerItemSchema = z.object({
  id: optionalSlug,
  label: text.min(1, 'Item label is required'),
  note: optionalText,
  done: bool.default(false),
});

const TrackerSectionSchema = z.object({
  title: text.min(1, 'Section title is required'),
  items: z.array(TrackerItemSchema).default([]),
});

export const TrackerSchema = z.object({
  title: text.min(1, 'Title is required'),
  type: z.enum(TRACKER_TYPE_IDS).default('checklist'),
  game: optionalSlug,
  summary: optionalText,
  sections: z.array(TrackerSectionSchema).default([]),
});

export const PlatformSchema = z.object({
  id: slug,
  name: text.min(1),
  short: text.min(1),
  raConsoleId: optionalInt.pipe(z.number().int().positive().optional()).transform((v) => v ?? null),
});

export const SiteSchema = z.object({
  title: text.min(1),
  tagline: text.default(''),
  owner: text.min(1),
  about: text.default(''),
  raUsername: text.default(''),
  links: z.array(z.object({ label: text.min(1), url: text.pipe(z.url()) })).default([]),
});

/** Validates `input` against `schema`, throwing a 400 with readable messages on failure. */
export function validate(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  const summary = details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ');
  throw badRequest(`Validation failed - ${summary}`, details);
}

/** Gives every tracker item a stable id derived from its label (used by visitors' localStorage). */
export function ensureTrackerItemIds(sections) {
  const seen = new Set();
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      let base = item.id || slugify(item.label) || 'item';
      let id = base;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
      seen.add(id);
      return { ...item, id };
    }),
  }));
}
