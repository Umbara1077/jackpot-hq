// Bundles src/{index-src.html, seeds.js, app-src.js} into the standalone index.html at the repo root.
// Usage: node src/build.js [extraOutDir]   (extraOutDir also gets artifact.html for publishing)
const fs = require('fs');
const path = require('path');

const src = __dirname;
const root = path.join(src, '..');
const extraOut = process.argv[2] || null;

const shell = fs.readFileSync(path.join(src, 'index-src.html'), 'utf8');
const seeds = fs.readFileSync(path.join(src, 'seeds.js'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app-src.js'), 'utf8');

if (!shell.includes('<!--__APP__-->')) { console.error('placeholder <!--__APP__--> missing from index-src.html'); process.exit(1); }

const scriptBlock = '<script>\n' + seeds + '\n' + app + '\n</script>';
// function form of replace: the app code contains "$$", which is a special pattern in string replacements
const full = shell.replace('<!--__APP__-->', () => scriptBlock);
fs.writeFileSync(path.join(root, 'index.html'), full);

// artifact variant: page content only — no doctype/html/head/body wrapper
if (extraOut) {
  const bodyInner = full.replace(/^[\s\S]*?<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '');
  const style = full.match(/<style>[\s\S]*?<\/style>/)[0];
  fs.writeFileSync(path.join(extraOut, 'artifact.html'), '<title>NJ Jackpot HQ</title>\n' + style + '\n' + bodyInner);
}

console.log('built index.html', (full.length / 1024).toFixed(1) + 'KB' + (extraOut ? ' (+ artifact.html)' : ''));
