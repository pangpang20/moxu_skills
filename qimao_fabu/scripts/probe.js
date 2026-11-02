#!/usr/bin/env node
/**
 * 探测脚本：打开墨序（源站）与奇猫作者后台（目标站），截图 + 导出 DOM 概览。
 * 用途：首次运行确认登录态、抓取"新建章节"页面的真实结构。
 *
 * 用法：node scripts/probe.js [--headless]
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, '.profile');
const OUT = path.join(ROOT, '.probe');
const SRC_URL = 'https://127.0.0.1:4317/';
const DST_URL =
  'https://zuozhe.qimao.com/front/book-manage/manage?id=13947939&title=%E5%B1%B1%E6%B2%B3%E4%B8%8D%E8%AE%B8%E4%BA%BA%E9%97%B4%E6%BA%90';

fs.mkdirSync(OUT, { recursive: true });

/** 把可见文本元素压成缩进树，便于人/模型阅读 */
function outlineScript() {
  const skip = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT']);
  const lines = [];
  const walk = (el, depth) => {
    if (depth > 14 || skip.has(el.tagName)) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();

    const attrs = [];
    if (el.id) attrs.push(`#${el.id}`);
    for (const a of ['class', 'name', 'type', 'placeholder', 'role', 'data-testid', 'aria-label']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && v.length < 90) attrs.push(`${a}="${v}"`);
    }
    const tag = el.tagName.toLowerCase();
    if (own || attrs.length) {
      lines.push(`${'  '.repeat(depth)}<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}> ${own.slice(0, 80)}`);
    }
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return lines.join('\n');
}

async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }).catch(() => {});
  const html = await page.content().catch(() => '');
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  const outline = await page.evaluate(outlineScript).catch((e) => 'evaluate failed: ' + e.message);
  fs.writeFileSync(path.join(OUT, `${name}.outline.txt`), outline);
  console.log(`[probe] ${name} -> ${page.url()}`);
}

(async () => {
  const headless = process.argv.includes('--headless');
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);

  try {
    await page.goto(SRC_URL, { waitUntil: 'domcontentloaded' });
    await shot(page, '01-src');

    await page.goto(DST_URL, { waitUntil: 'domcontentloaded' });
    await shot(page, '02-dst');

    // 尝试列出当前所有页面（可能弹了新标签）
    for (const [i, p] of context.pages().entries()) {
      if (i === 0) continue;
      await shot(p, `03-extra-${i}`);
    }
  } finally {
    if (!headless) {
      console.log('[probe] 浏览器保持打开 20 秒供人工检查…');
      await page.waitForTimeout(20000);
    }
    await context.close();
  }
})();
