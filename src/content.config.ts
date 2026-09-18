import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { STATUS_IDS, OWNERSHIP_IDS, GUIDE_TYPE_IDS, TRACKER_TYPE_IDS } from './lib/constants.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Expected an ISO date (YYYY-MM-DD)');
const enumOf = (ids: string[]) => z.enum(ids as [string, ...string[]]);

/** One JSON file per game: src/content/games/<slug>.json */
const games = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/games' }),
  schema: z.object({
    title: z.string().min(1),
    platform: z.string().min(1),
    cover: z.string().optional(),
    genres: z.array(z.string()).default([]),
    developer: z.string().optional(),
    publisher: z.string().optional(),
    releaseYear: z.number().int().optional(),
    ownership: enumOf(OWNERSHIP_IDS).default('owned'),
    favorite: z.boolean().default(false),
    status: enumOf(STATUS_IDS).default('unplayed'),
    rating: z.number().min(0).max(10).optional(),
    hoursPlayed: z.number().min(0).optional(),
    startedAt: isoDate.optional(),
    finishedAt: isoDate.optional(),
    raGameId: z.number().int().positive().optional(),
    review: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).default([]),
    addedAt: z.string(),
    updatedAt: z.string(),
  }),
});

/** Markdown guides: src/content/guides/<slug>.md */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string().min(1),
    type: enumOf(GUIDE_TYPE_IDS).default('notes'),
    game: reference('games').optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

/** Structured checklists (missables etc.): src/content/trackers/<slug>.json */
const trackers = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/trackers' }),
  schema: z.object({
    title: z.string().min(1),
    type: enumOf(TRACKER_TYPE_IDS).default('checklist'),
    game: reference('games').optional(),
    summary: z.string().optional(),
    sections: z
      .array(
        z.object({
          title: z.string().min(1),
          items: z.array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
              note: z.string().optional(),
              done: z.boolean().default(false),
            }),
          ),
        }),
      )
      .default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

/** RetroAchievements per-game snapshots written by the admin sync: src/content/ra-games/<raGameId>.json */
const raGames = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/ra-games' }),
  schema: z.object({
    gameId: z.number().int(),
    title: z.string(),
    consoleId: z.number().int().optional(),
    consoleName: z.string().optional(),
    imageIcon: z.string().optional(),
    imageBoxArt: z.string().optional(),
    numAchievements: z.number().int().default(0),
    numAwarded: z.number().int().default(0),
    numAwardedHardcore: z.number().int().default(0),
    completion: z.number().default(0),
    completionHardcore: z.number().default(0),
    highestAwardKind: z.string().nullable().default(null),
    highestAwardDate: z.string().nullable().default(null),
    syncedAt: z.string(),
    achievements: z
      .array(
        z.object({
          id: z.number().int(),
          title: z.string(),
          description: z.string().default(''),
          points: z.number().default(0),
          trueRatio: z.number().default(0),
          badge: z.string().optional(),
          type: z.string().nullable().default(null),
          displayOrder: z.number().default(0),
          numAwarded: z.number().default(0),
          numAwardedHardcore: z.number().default(0),
          earnedAt: z.string().nullable().default(null),
          earnedHardcoreAt: z.string().nullable().default(null),
        }),
      )
      .default([]),
  }),
});

export const collections = { games, guides, trackers, raGames };
