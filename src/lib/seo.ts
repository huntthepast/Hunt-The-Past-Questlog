import { site, platformOf, trackerProgress, type Game, type Guide, type Tracker } from './data';
import { statusById, guideType, trackerTypeById } from './constants.js';

/*
 * Titles, descriptions and JSON-LD structured data for the public pages.
 * Everything here is plain data; Base.astro renders it.
 */

const DESCRIPTION_MAX = 158;

/** Cuts text at a word boundary and adds an ellipsis; never splits a word or a sentence mid-way if a full stop is near. */
export function truncate(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const sentenceEnd = slice.lastIndexOf('. ');
  if (sentenceEnd > max * 0.6) return slice.slice(0, sentenceEnd + 1);
  const wordEnd = slice.lastIndexOf(' ');
  return (wordEnd > 0 ? slice.slice(0, wordEnd) : slice).replace(/[,;:\-]$/, '') + '…';
}

/** Rough Markdown -> plain text for descriptions (strips headings, links, images, emphasis, tables). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*[-*+]\s+\[[ xX]]\s+/gm, '')
    .replace(/^\s*[-*+>]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const absolute = (path: string | undefined, base: URL | undefined) => (path && base ? new URL(path, base).toString() : undefined);

/* ---------- page titles & descriptions ---------- */

export function gameSeo(game: Game, guideCount: number, trackerCount: number) {
  const d = game.data;
  const platform = platformOf(d.platform);
  const status = statusById(d.status);
  const title = `${d.title} (${platform.short}) - ${d.ownership === 'wishlist' ? 'Wishlist' : status.label}`;

  const facts: string[] = [];
  if (d.ownership === 'wishlist') facts.push('on the wishlist');
  else facts.push(status.label.toLowerCase());
  if (d.rating !== undefined) facts.push(`rated ${d.rating}/10`);
  if (d.hoursPlayed) facts.push(`${d.hoursPlayed}h played`);
  const extras: string[] = [];
  if (guideCount) extras.push(`${guideCount} ${guideCount === 1 ? 'guide' : 'guides'}`);
  if (trackerCount) extras.push(`${trackerCount} ${trackerCount === 1 ? 'tracker' : 'trackers'}`);
  if (d.raGameId) extras.push('RetroAchievements progress');

  let description = `${d.title} on ${platform.name}: ${facts.join(', ')}.`;
  if (extras.length) description += ` ${extras.join(', ')}.`;
  if (d.review) description += ` ${plainText(d.review)}`;
  return { title, description: truncate(description) };
}

export function guideSeo(guide: Guide, game: Game | undefined, body: string) {
  const d = guide.data;
  const type = guideType(d.type);
  const platform = game ? platformOf(game.data.platform) : undefined;
  const title = platform ? `${d.title} (${platform.short})` : d.title;
  const intro = d.summary ?? plainText(body);
  const description = truncate(`${type.label}${game ? ` for ${game.data.title}` : ''}. ${intro}`);
  return { title, description };
}

export function trackerSeo(tracker: Tracker, game: Game | undefined) {
  const d = tracker.data;
  const type = trackerTypeById(d.type);
  const platform = game ? platformOf(game.data.platform) : undefined;
  const progress = trackerProgress(tracker);
  // Avoid "Missables - Missables tracker" when the title already names the type.
  const kind = d.title.toLowerCase().includes(type.label.toLowerCase()) ? 'tracker' : `${type.label} tracker`;
  const title = `${d.title} - ${kind}${platform ? ` (${platform.short})` : ''}`;
  const description = truncate(`${d.summary ?? `${type.label} checklist${game ? ` for ${game.data.title}` : ''}.`} ${progress.total} items, ${progress.done} done so far.`);
  return { title, description };
}

/* ---------- JSON-LD ---------- */

type JsonLd = Record<string, unknown>;

export function websiteJsonLd(base: URL | undefined): JsonLd[] {
  const url = base?.toString();
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.title,
      alternateName: `${site.owner}'s ${site.title}`,
      description: site.tagline,
      url,
      author: { '@type': 'Person', name: site.owner },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.owner,
      url,
      sameAs: site.links.map((l) => l.url),
    },
  ];
}

export function breadcrumbJsonLd(base: URL | undefined, crumbs: { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path, base),
    })),
  };
}

export function gameJsonLd(base: URL | undefined, game: Game): JsonLd {
  const d = game.data;
  const platform = platformOf(d.platform);
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: d.title,
    url: absolute(`/games/${game.id}`, base),
    gamePlatform: platform.name,
    applicationCategory: 'Game',
  };
  if (d.cover) data.image = absolute(d.cover, base);
  if (d.genres.length) data.genre = d.genres;
  if (d.developer) data.author = { '@type': 'Organization', name: d.developer };
  if (d.publisher) data.publisher = { '@type': 'Organization', name: d.publisher };
  if (d.releaseYear) data.datePublished = String(d.releaseYear);
  if (d.review && d.rating !== undefined) {
    data.review = {
      '@type': 'Review',
      author: { '@type': 'Person', name: site.owner },
      datePublished: d.finishedAt ?? d.updatedAt.slice(0, 10),
      reviewBody: plainText(d.review),
      reviewRating: { '@type': 'Rating', ratingValue: d.rating, bestRating: 10, worstRating: 0 },
    };
  }
  return data;
}

export function guideJsonLd(base: URL | undefined, guide: Guide, game: Game | undefined, description: string): JsonLd {
  const d = guide.data;
  const image = d.gallery[0]?.src ?? game?.data.cover;
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: d.title,
    description,
    url: absolute(`/guides/${guide.id}`, base),
    datePublished: d.createdAt,
    dateModified: d.updatedAt,
    author: { '@type': 'Person', name: site.owner },
    publisher: { '@type': 'Person', name: site.owner },
    articleSection: guideType(d.type).label,
    keywords: d.tags.join(', ') || undefined,
    inLanguage: 'en',
  };
  if (image) data.image = absolute(image, base);
  if (d.version) data.version = d.version;
  if (game) data.about = { '@type': 'VideoGame', name: game.data.title, url: absolute(`/games/${game.id}`, base) };
  return data;
}
