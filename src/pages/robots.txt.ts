import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = site
    ? new URL('sitemap-index.xml', site).href
    : 'https://uploadright.pages.dev/sitemap-index.xml';
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
