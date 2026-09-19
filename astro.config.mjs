// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import alpinejs from '@astrojs/alpinejs';
import sitemap from '@astrojs/sitemap';

/**
 * Last-modified dates for the sitemap, read straight from the content files
 * (the content collections are not available this early in the build).
 */
function lastModified() {
  const dates = { games: {}, guides: {}, trackers: {} };
  const read = (dir, ext, extract) => {
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(ext)) continue;
        const slug = file.slice(0, -ext.length);
        const date = extract(readFileSync(`${dir}/${file}`, 'utf8'));
        if (date) dates[dir.split('/').pop()][slug] = date;
      }
    } catch {
      /* directory missing: nothing to add */
    }
  };
  const fromJson = (text) => JSON.parse(text).updatedAt;
  const fromFrontmatter = (text) => text.match(/^updatedAt:\s*"?([^"\n]+)"?/m)?.[1];
  read('src/content/games', '.json', fromJson);
  read('src/content/trackers', '.json', fromJson);
  read('src/content/guides', '.md', fromFrontmatter);
  return dates;
}

const modified = lastModified();

// https://astro.build/config
export default defineConfig({
  // Public site URL. Change this when you attach a custom domain on Vercel (canonical URLs, sitemap and share images use it).
  site: 'https://hunt-the-past-questlog.vercel.app',
  output: 'static',
  trailingSlash: 'never',
  // Astro 7 defaults to JSX-style whitespace stripping, which eats the space between text and an
  // inline element on the next line. Classic compression keeps a single space there.
  compressHTML: true,
  integrations: [
    alpinejs({ entrypoint: '/src/alpine' }),
    sitemap({
      filter: (page) => !page.endsWith('/404'),
      serialize(item) {
        const match = item.url.match(/\/(games|guides|trackers)\/([^/]+)\/?$/);
        const date = match ? modified[match[1]]?.[match[2]] : undefined;
        if (date) item.lastmod = new Date(date).toISOString();
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
