import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');

function getAllHtmlFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllHtmlFiles(fullPath));
    } else if (file.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

const expectedOrigin = (process.env.PUBLIC_SITE_URL || 'https://uploadright.pages.dev').replace(/\/$/, '');

test('SEO Audit: All static pages have title, meta description, canonical, h1 and valid JSON-LD', () => {
  const htmlFiles = getAllHtmlFiles(distDir);
  assert.ok(htmlFiles.length >= 35, `Expected at least 35 HTML pages, found ${htmlFiles.length}`);

  for (const filePath of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(distDir, filePath);

    // Title Check
    const titleMatch = content.match(/<title>([^<]+)<\/title>/);
    assert.ok(titleMatch, `Missing <title> in ${relativePath}`);
    const title = titleMatch[1].trim();
    assert.ok(title.length >= 10, `Title too short in ${relativePath}: "${title}"`);

    // Meta Description Check
    const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    assert.ok(descMatch, `Missing meta description in ${relativePath}`);
    const desc = descMatch[1].trim();
    assert.ok(desc.length >= 40, `Meta description too short in ${relativePath}: "${desc}"`);

    // Canonical Tag Check (Must match dynamic site URL)
    const canonicalMatch = content.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    assert.ok(canonicalMatch, `Missing canonical link in ${relativePath}`);
    assert.ok(
      canonicalMatch[1].startsWith(expectedOrigin),
      `Canonical URL must start with ${expectedOrigin} in ${relativePath}, got: ${canonicalMatch[1]}`
    );

    // H1 Heading Check
    const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    assert.ok(h1Match, `Missing <h1> in ${relativePath}`);

    // JSON-LD Check
    const jsonLdMatches = content.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      assert.doesNotThrow(() => {
        JSON.parse(match[1]);
      }, `Invalid JSON-LD schema in ${relativePath}`);
    }
  }
});

test('Competitor & Traffic Hubs: /image-resizer and /signature-compressor are full static routes', () => {
  // /image-resizer (Competitor's 46% traffic driver)
  const imageResizerPath = path.join(distDir, 'image-resizer', 'index.html');
  assert.ok(fs.existsSync(imageResizerPath), '/image-resizer must exist as a pre-rendered static route');
  const imageResizerHtml = fs.readFileSync(imageResizerPath, 'utf-8');
  assert.ok(imageResizerHtml.includes('Online Image Resizer'), '/image-resizer must include target H1 keyword "Online Image Resizer"');
  assert.ok(imageResizerHtml.includes('Photo Resize in KB') || imageResizerHtml.includes('photo resize in kb'), '/image-resizer must include target phrase "Photo Resize in KB"');

  // /signature-compressor
  const sigCompressorPath = path.join(distDir, 'signature-compressor', 'index.html');
  assert.ok(fs.existsSync(sigCompressorPath), '/signature-compressor must exist as a pre-rendered static route');
  const sigCompressorHtml = fs.readFileSync(sigCompressorPath, 'utf-8');
  assert.ok(sigCompressorHtml.includes('Signature Compressor'), '/signature-compressor must include target keyword "Signature Compressor"');
});

test('Legal Pages Deduplication: /terms is canonical and /terms-of-service redirects', () => {
  const termsPath = path.join(distDir, 'terms', 'index.html');
  assert.ok(fs.existsSync(termsPath), '/terms must exist as canonical Terms page');

  const termsOfServicePath = path.join(distDir, 'terms-of-service', 'index.html');
  assert.ok(!fs.existsSync(termsOfServicePath), '/terms-of-service must NOT exist as duplicate static page');

  const redirectsPath = path.join(distDir, '_redirects');
  assert.ok(fs.existsSync(redirectsPath), '_redirects must exist');
  const redirectsContent = fs.readFileSync(redirectsPath, 'utf-8');
  assert.ok(redirectsContent.includes('/terms-of-service /terms 301'), '_redirects must 301 redirect /terms-of-service to /terms');
});

test('Broken Link Audit: All internal links across all pages resolve to valid routes', () => {
  const htmlFiles = getAllHtmlFiles(distDir);
  const internalLinkRegex = /<a\s+[^>]*?href=["'](\/[^"#'?]*)["']/gi;
  const missingTargets = new Set();

  for (const filePath of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    let match;
    while ((match = internalLinkRegex.exec(content)) !== null) {
      const linkPath = match[1];
      if (linkPath === '' || linkPath === '/') continue;
      if (linkPath.endsWith('.xml') || linkPath.endsWith('.txt') || linkPath.endsWith('.png') || linkPath.endsWith('.svg') || linkPath.endsWith('.ico') || linkPath.endsWith('.css') || linkPath.endsWith('.js')) {
        const assetFile = path.join(distDir, linkPath.slice(1));
        if (!fs.existsSync(assetFile)) {
          missingTargets.add(`${linkPath} (referenced in ${path.relative(distDir, filePath)})`);
        }
        continue;
      }

      // Check if dist/<linkPath>/index.html or dist/<linkPath>.html exists
      const cleanPath = linkPath.replace(/^\//, '').replace(/\/$/, '');
      const candidate1 = path.join(distDir, cleanPath, 'index.html');
      const candidate2 = path.join(distDir, `${cleanPath}.html`);

      // Check redirects file as well
      const redirectsFile = path.join(distDir, '_redirects');
      const isRedirected = fs.existsSync(redirectsFile) && fs.readFileSync(redirectsFile, 'utf-8').includes(`/${cleanPath} `);

      if (!fs.existsSync(candidate1) && !fs.existsSync(candidate2) && !isRedirected) {
        missingTargets.add(`Route /${cleanPath} referenced in ${path.relative(distDir, filePath)}`);
      }
    }
  }

  assert.deepEqual(Array.from(missingTargets), [], `Found broken internal links:\n${Array.from(missingTargets).join('\n')}`);
});

test('Cloudflare Deployment Artifacts: Robots, sitemap, headers, redirects exist', () => {
  assert.ok(fs.existsSync(path.join(distDir, 'robots.txt')), 'robots.txt must exist in dist');
  assert.ok(fs.existsSync(path.join(distDir, 'sitemap-index.xml')), 'sitemap-index.xml must exist in dist');
  assert.ok(fs.existsSync(path.join(distDir, '_headers')), '_headers must exist in dist');
  assert.ok(fs.existsSync(path.join(distDir, '_redirects')), '_redirects must exist in dist');
  assert.ok(fs.existsSync(path.join(distDir, 'favicon.svg')), 'favicon.svg must exist in dist');

  // Verify robots.txt contains sitemap URL
  const robotsContent = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf-8');
  assert.ok(robotsContent.includes('Sitemap:'), 'robots.txt must declare Sitemap:');
  assert.ok(robotsContent.includes(expectedOrigin), `robots.txt must reference ${expectedOrigin}`);
});
