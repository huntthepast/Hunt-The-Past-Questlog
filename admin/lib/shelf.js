import { z } from 'zod';
import * as store from './store.js';
import { validate } from './schemas.js';

/*
 * Trophy shelf ordering. Mirrors src/lib/data.ts (shelfAwards): one badge per game (its best award),
 * in RetroAchievements' profile order (DisplayOrder, then date earned), with manual overrides from
 * src/data/shelf.json applied on top.
 */

const rank = (a) => {
  if (a.type === 'Mastery/Completion') return a.hardcore ? 4 : 3;
  if (a.type === 'Game Beaten') return a.hardcore ? 2 : 1;
  return 0;
};

const KIND = { 4: 'mastered', 3: 'completed', 2: 'beaten-hardcore', 1: 'beaten-softcore' };

export const ShelfSchema = z.object({
  order: z.array(z.number().int().positive()).default([]),
  hidden: z.array(z.number().int().positive()).default([]),
});

/** Awards as the site will show them (hidden ones included, flagged, at the end) plus the overrides. */
export async function shelfState() {
  const [profile, overrides] = await Promise.all([store.getRaProfile(), store.getShelf()]);
  const best = new Map();
  for (const a of profile.awards ?? []) {
    if (a.gameId == null || rank(a) === 0) continue;
    const current = best.get(a.gameId);
    if (!current || rank(a) > rank(current)) best.set(a.gameId, a);
  }
  const position = new Map(overrides.order.map((id, index) => [id, index]));
  const hidden = new Set(overrides.hidden);
  const awards = [...best.values()]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || String(a.awardedAt).localeCompare(String(b.awardedAt)))
    .sort((a, b) => {
      const pa = position.get(a.gameId);
      const pb = position.get(b.gameId);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return 0;
    })
    .map((a) => ({
      gameId: a.gameId,
      title: a.title,
      consoleName: a.consoleName,
      imageIcon: a.imageIcon,
      kind: KIND[rank(a)],
      awardedAt: a.awardedAt,
      displayOrder: a.displayOrder ?? 0,
      hidden: hidden.has(a.gameId),
    }));
  // Keep hidden badges visible to the editor, parked at the bottom.
  awards.sort((a, b) => Number(a.hidden) - Number(b.hidden));
  return {
    manual: overrides.order.length > 0 || overrides.hidden.length > 0,
    hasDisplayOrder: (profile.awards ?? []).some((a) => a.displayOrder !== undefined),
    awards,
    overrides,
  };
}

export async function saveShelf(input) {
  const data = validate(ShelfSchema, input);
  const dedupe = (list) => [...new Set(list)];
  await store.saveShelf({ order: dedupe(data.order), hidden: dedupe(data.hidden) });
  return shelfState();
}
