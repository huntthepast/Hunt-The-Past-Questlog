export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "The Legend of Zelda: A Link to the Past" -> "the-legend-of-zelda-a-link-to-the-past" */
export function slugify(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip diacritics (combining marks left over from NFKD)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

export const isSlug = (value) => typeof value === 'string' && SLUG_RE.test(value);

/** Appends -2, -3, ... until `exists(slug)` is false. */
export async function uniqueSlug(base, exists) {
  let slug = base || 'untitled';
  let n = 2;
  while (await exists(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
