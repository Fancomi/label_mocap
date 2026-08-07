#!/usr/bin/env node
// pcd_label 背景点云的浏览器冒烟测试。走 webkitdirectory 退化路径（FS Access 的目录
// 选择器无法在无头环境里驱动），用 uploadFile 把目录里的文件塞进 <input> ——
// FileListSource 取的是 basename，所以不带 webkitRelativePath 也能工作。
//
// 不进 npm test（依赖本机 Chrome、临时端口与外部数据目录）。需要时手动跑：
//   npm i --no-save puppeteer-core
//   node pcd_label/tools/background_check.mjs <seq-dir> <bg-dir>
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5186;
const [seqDir, bgDir] = process.argv.slice(2);
if (!seqDir || !bgDir) {
  console.error('用法: node pcd_label/tools/background_check.mjs <seq-dir> <bg-dir>');
  process.exit(2);
}

const filesIn = async (dir) => (await readdir(dir))
  .filter((n) => n === 'manifest.json' || n === 'player_0.json' || n.endsWith('.png'))
  .map((n) => path.resolve(dir, n));

const server = spawn('node', ['smpl_web_viewer/tools/static_server.mjs', '--root', '.', '--port', String(PORT)], { stdio: 'ignore' });
const done = (code) => { server.kill(); process.exit(code); };
await new Promise((r) => setTimeout(r, 900));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(`http://localhost:${PORT}/pcd_label/`, { waitUntil: 'networkidle2', timeout: 30000 });

// puppeteer 的 uploadFile 无法给带 webkitdirectory 的 input 赋值（目录选择走的是
// 另一条 CDP 路径）。去掉该属性即可 —— FileListSource 只按 basename 建索引，
// 拿到的是同一批 File，代码路径与真实的目录选择完全一致。
await page.evaluate(() => {
  for (const id of ['dir-input', 'bg-input']) document.getElementById(id).removeAttribute('webkitdirectory');
});

// 前景序列：webkitdirectory 输入 → mountSequence（含 19 MB SMPL 模型下载）。
await (await page.$('#dir-input')).uploadFile(...await filesIn(seqDir));
await page.waitForFunction(() => /已加载 \d+ 帧/.test(document.getElementById('status').textContent), { timeout: 120000 });
const fg = await page.evaluate(() => document.getElementById('status').textContent);
console.log('前景    ', fg);

const before = await page.evaluate(() => !document.getElementById('btn-load-bg').disabled);
console.log('背景按钮', before ? '已启用' : '仍禁用（应在载入序列后启用）');

// 背景 loop。
await (await page.$('#bg-input')).uploadFile(...await filesIn(bgDir));
await page.waitForFunction(() => /已载入背景 \d+ 帧/.test(document.getElementById('status').textContent), { timeout: 60000 });
console.log('背景    ', await page.evaluate(() => document.getElementById('status').textContent));

// 切帧后背景应仍在（按帧号取模跟随，缓存命中）；开关能真的隐藏它。
await page.click('#btn-next');
await new Promise((r) => setTimeout(r, 500));
const shotWith = await page.screenshot({ encoding: 'base64', clip: { x: 300, y: 0, width: 800, height: 700 } });
await page.click('#t-background');
await new Promise((r) => setTimeout(r, 500));
const shotWithout = await page.screenshot({ encoding: 'base64', clip: { x: 300, y: 0, width: 800, height: 700 } });
const sizeWith = Buffer.from(shotWith, 'base64').length;
const sizeWithout = Buffer.from(shotWithout, 'base64').length;
console.log('截图    ', `含背景 ${Math.round(sizeWith / 1024)} KB · 关背景 ${Math.round(sizeWithout / 1024)} KB`);

// 误把背景目录当主序列打开 → 应给出明确错误而不是静默显示静态场景。
await page.click('#t-background');
await (await page.$('#dir-input')).uploadFile(...await filesIn(bgDir));
await new Promise((r) => setTimeout(r, 1200));
const guard = await page.evaluate(() => document.getElementById('status').textContent);
console.log('误用防护', guard);

await browser.close();
const failed = errors.length
  || !before                                   // 载入序列后背景按钮应启用
  || sizeWithout >= sizeWith                   // 关掉背景后画面应更简单（截图更小）
  || !/背景 loop/.test(guard);                 // 误把背景目录当主序列 → 明确报错
if (errors.length) console.log('\n错误：\n' + errors.map((e) => '  ' + e).join('\n'));
console.log(failed ? '\n✖ 背景点云冒烟测试失败' : '\n✔ 背景点云冒烟测试通过');
done(failed ? 1 : 0);
