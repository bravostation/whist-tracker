// Run with: node tests/hdr-accent.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const jpeg = readFileSync(new URL('../assets/title-white-hdr.jpg', import.meta.url));
assert.match(html, /<h1>🃏 <span class="title-accent">Contract Whist<\/span><\/h1>/);
assert.equal((html.match(/class="title-accent"/g) || []).length, 1);
assert.match(css, /@media screen and \(dynamic-range: high\) and \(prefers-color-scheme: dark\) and \(forced-colors: none\)/);
assert.match(css, /@supports \(\(background-clip: text\) or \(-webkit-background-clip: text\)\)/);
assert.match(css, /background-color: var\(--text\)/);
assert.match(css, /\.title-accent::selection\s*\{[^}]*-webkit-text-fill-color: HighlightText/s);
assert.match(css, /@media print\s*\{\s*\.title-accent\s*\{[^}]*background: none;[^}]*color: inherit;[^}]*-webkit-text-fill-color: currentColor/s);
assert.equal(createHash('sha256').update(jpeg).digest('hex'), '511edb2c416eb20f902d7b6c5015063ee1169ea9b34c085e02b07a9cc5406d32');
assert.ok(jpeg.includes(Buffer.from('urn:iso:std:iso:ts:21496:-1')));
assert.ok(jpeg.includes(Buffer.from('http://ns.adobe.com/hdr-gain-map/1.0/')));
console.log('PASS: title scope, capability gates, fallback, selection, print, verified gain-map asset');
