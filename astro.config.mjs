// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import alpinejs from '@astrojs/alpinejs';

// https://astro.build/config
export default defineConfig({
  // Public site URL. Update this after you attach a domain on Vercel.
  site: 'https://hunt-the-past-questlog.vercel.app',
  output: 'static',
  trailingSlash: 'never',
  // Astro 7 defaults to JSX-style whitespace stripping, which eats the space between text and an
  // inline element on the next line. Classic compression keeps a single space there.
  compressHTML: true,
  integrations: [alpinejs({ entrypoint: '/src/alpine' })],
  vite: {
    plugins: [tailwindcss()],
  },
});
