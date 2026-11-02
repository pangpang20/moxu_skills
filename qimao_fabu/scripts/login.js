#!/usr/bin/env node
/**
 * 登录探针：打开可见浏览器，等待用户在两个站点各自完成登录。
 * 两边都登录成功后，自动导出奇猫后台的 DOM 结构，供后续编写选择器。
 *
 * 用法：node scripts/login.js
 * 产出：.probe/03-dst-manage.* / .probe/04-dst-editor.*
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, '.profile');
const OUT = path.join(ROOT, '.probe');
const SRC_URL = 'https://127.0.0.1:4317/';
const DST_URL = 'https://zuozhe.qimao.com/front/book-manage';

fs.mkdirSync(OUT, { recursive: true });

const OUTLINE_FN = () => {
  const skip = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT']);
  const lines = [];
  const walk = (el, depth) => {
    if (depth > 16 || skip.has(el.tagName)) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    const attrs = [];
    if (el.id) attrs.push('#' + el.id);
    for (const a of ['class', 'name', 'type', 'placeholder', 'role', 'aria-label', 'contenteditable']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && v.length < 90) attrs.push(`${a}="${v}"`);
    }
    const tag = el.tagName.toLowerCase();
    if (own || attrs.length) {
      lines.push(`${'  '.repeat(depth)}<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}> ${own.slice(0, 90)}`);
    }
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.body, 0);
  return lines.join('\n');
};

async function dump(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  fs.writeFileSync(path.join(OUT, `${name}.html`), await page.content().catch(() => ''));
  fs.writeFileSync(
    path.join(OUT, `${name}.outline.txt`),
    await page.evaluate(OUTLINE_FN).catch((e) => 'failed: ' + e.message)
  );
  console.log(`[login] 已导出 ${name}`);
}

const srcLoggedIn = async (ctx) => {
  for (const p of ctx.pages()) {
    if (!p.url().includes('127.0.0.1:4317')) continue;
    try {
      const ok = await p.evaluate(() =>
        fetch('/api/auth/session')
          .then((r) => r.json())
          .then((j) => Boolean(j.authenticated))
          .catch(() => false)
      );
      if (ok) return true;
    } catch {}
  }
  return false;
};

const dstLoggedIn = async (ctx) => {
  for (const p of ctx.pages()) {
    if (!p.url().includes('zuozhe.qimao.com')) continue;
    if (/register-login|\/login/i.test(p.url())) continue;
    return p;
  }
  return null;
};

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });

  const src = await ctx.newPage();
  await src.goto(SRC_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const dst = await ctx.newPage();
  await dst.goto(DST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('==============================================');
  console.log('请在打开的浏览器里完成两个站点的登录：');
  console.log('  1) 墨序本地写作台（左侧标签页）');
  console.log('  2) 奇猫作者后台（右侧标签页，手机验证码或账号密码）');
  console.log('登录完成后无需任何操作，脚本会自动继续…');
  console.log('==============================================');

  const deadline = Date.now() + 15 * 60 * 1000;
  let okSrc = false;
  let okDst = null;
  while (Date.now() < deadline) {
    if (!okSrc) okSrc = await srcLoggedIn(ctx);
    if (!okDst) okDst = await dstLoggedIn(ctx);
    if (okSrc && okDst) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!okSrc || !okDst) {
    console.log('[login] 超时或未完成登录，退出。');
    await ctx.close();
    process.exit(1);
  }

  console.log('[login] 两个站点均已登录，开始导出结构…');
  const manage = okDst;
  await manage.goto(DST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await manage.waitForTimeout(4000);
  await dump(manage, '03-dst-manage');

  // 尝试点开"新建章节"一类按钮，把编辑器结构也导出来
  const candidates = ['新建章节', '新建', '添加章节', '创建章节', '写新章节', '新增章节'];
  let opened = false;
  for (const text of candidates) {
    const loc = manage.getByText(text, { exact: true }).first();
    if (await loc.count().catch(() => 0)) {
      try {
        await loc.click({ timeout: 3000 });
        await manage.waitForTimeout(2500);
        await dump(manage, '04-dst-editor');
        console.log(`[login] 已点击「${text}」并导出编辑器结构`);
        opened = true;
        break;
      } catch {}
    }
  }
  if (!opened) console.log('[login] 未自动找到"新建章节"按钮，仅导出管理页结构。');

  await manage.screenshot({ path: path.join(OUT, '05-final.png') }).catch(() => {});
  await ctx.close();
  console.log('[login] 完成。profile 已保存，下次无需登录。');
})();
