import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://lidge-jun.github.io',
  base: '/progrok/',
  trailingSlash: 'never',
  build: { inlineStylesheets: 'auto' },
});
