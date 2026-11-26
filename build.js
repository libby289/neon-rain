const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, '霓虹雨夜_NEON_RAIN.html');
const ORDER = ['00-core.js', '10-scene.js', '20-fx.js', '30-post.js', '40-player.js', '50-enemies.js', '60-main.js'];

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'three.min.js'), 'utf8');
const parts = ORDER.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8'));
const game = parts.join('\n');

const esc = s => s.replace(/<\/script/gi, '<\\/script');

// syntax check the bundle as plain script
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'game.bundle.js'), game);

const out = html
  .replace('<!--THREE-->', () => '<script>\n' + esc(three) + '\n</script>')
  .replace('<!--GAME-->', () => '<script>\n' + esc(game) + '\n</script>');

fs.writeFileSync(OUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log('built ->', OUT, kb + ' KB');
