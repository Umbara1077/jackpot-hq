// Builds ../index.html (standalone) and artifact.html (for the Claude artifact) from src files.
const fs = require('fs');
const path = require('path');
const src = __dirname;
const root = path.join(src, '..');
const scratch = process.argv[2]; // scratchpad dir containing seeds.js
if (!scratch) { console.error('usage: node build.js <scratchpad-dir-with-seeds.js>'); process.exit(1); }

const shell = fs.readFileSync(path.join(src, 'index-src.html'), 'utf8');
const seeds = fs.readFileSync(path.join(scratch, 'seeds.js'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app-src.js'), 'utf8');

const scriptBlock = '<script>\n' + seeds + '\n' + app + '\n</script>';
if (!shell.includes('<!--__APP__-->')) { console.error('placeholder missing'); process.exit(1); }
const full = shell.replace('<!--__APP__-->', () => scriptBlock); // function form: '$$' in code must not be treated as a replace pattern
fs.writeFileSync(path.join(scratch, 'index.html'), full);

// artifact variant: page content only (no doctype/html/head/body) — keep title, meta theme, style, markup, script
const bodyInner = full
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '');
const styleMatch = full.match(/<style>[\s\S]*?<\/style>/);
const artifact = '<title>NJ Jackpot HQ</title>\n' + styleMatch[0] + '\n' + bodyInner;
fs.writeFileSync(path.join(scratch, 'artifact.html'), artifact);

console.log('OK index.html', (full.length / 1024).toFixed(1) + 'KB · artifact.html', (artifact.length / 1024).toFixed(1) + 'KB');
