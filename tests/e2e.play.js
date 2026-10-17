// 端到端：在无头 Chromium 中加载 public/，等待引擎就绪，与引擎对弈若干回合。
//   node tests/e2e.play.js [port]   （需先 bash scripts/build-site.sh；依赖 playwright）
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'node_modules/playwright') : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8787);

const server = spawn('node', [path.join(root, 'pikafish-web/demo/serve.js'), String(port), path.join(root, 'public')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForSelector('body[data-engine="ready"]', { timeout: 180000 });
  console.log(`✓ 引擎就绪 ${Date.now() - t0} ms，状态：${await page.textContent('#status')}`);

  // 选 1 级，红方；新对局
  await page.selectOption('#level', '1');
  await page.selectOption('#side', 'red');
  await page.click('#btnNew');
  await page.waitForFunction(() => /轮到你走/.test(document.getElementById('status').textContent));

  const clickSq = async (name) => page.click(`circle.hit[data-sq="${sqIndex(name)}"]`, { force: true });
  const sqIndex = (n) => Number(n[1]) * 9 + 'abcdefghi'.indexOf(n[0]);
  const human = ['h2e2', 'h0g2', 'i0h0', 'b0c2', 'a0a1', 'a1d1', 'c3c4', 'b2b4', 'g3g4', 'e2e6'];
  for (const mv of human) {
    const before = await page.evaluate(() => window.xq.state.pos.history.length);
    const legal = await page.evaluate((m) => window.xq.state.pos.isLegal(window.xq.sqFromName(m.slice(0, 2)), window.xq.sqFromName(m.slice(2))), mv);
    if (!legal) { console.log(`  (跳过不合法/被挡的预设着法 ${mv})`); continue; }
    await page.evaluate((m) => window.xq.state.pos.board, mv);
    await clickSq(mv.slice(0, 2));
    await clickSq(mv.slice(2));
    await page.waitForFunction((b) => window.xq.state.pos.history.length >= b + 2 || window.xq.state.over, before, { timeout: 60000 });
    const h = await page.evaluate(() => window.xq.state.pos.history.slice(-2).map((x) => x.notation + '(' + x.uci + ')'));
    const think = await page.textContent('#think');
    console.log(`  ${h.join('  ')}   ${think}`);
    if (await page.evaluate(() => !!window.xq.state.over)) { console.log('  对局结束：' + await page.textContent('#status')); break; }
  }
  // 悔棋
  const n1 = await page.evaluate(() => window.xq.state.pos.history.length);
  await page.click('#btnUndo');
  const n2 = await page.evaluate(() => window.xq.state.pos.history.length);
  console.log(`✓ 悔棋：${n1} -> ${n2} 步，状态：${await page.textContent('#status')}`);

  // 高难度一步计时（7 级）
  await page.selectOption('#level', '7');
  const t1 = Date.now();
  await clickSq('e3'); await clickSq('e4');
  await page.waitForFunction((n) => window.xq.state.pos.history.length >= n + 2, n2, { timeout: 120000 });
  console.log(`✓ 7 级应答用时 ${Date.now() - t1} ms：${await page.textContent('#think')}`);

  await page.screenshot({ path: path.join(root, 'tests', 'e2e.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, 'tests', 'e2e-mobile.png'), fullPage: true });
  if (errors.length) { console.log('✗ 页面错误：'); errors.forEach((e) => console.log('   ' + e)); process.exitCode = 1; }
  else console.log('✓ 无页面错误  E2E OK');
} catch (e) {
  console.error('FAILED', e);
  if (errors.length) errors.forEach((x) => console.log('   ' + x));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
