#!/usr/bin/env node
/**
 * 源站取数：从墨序本地写作台读取指定作品的所有「已定稿」章节（标题 + 正文）。
 * 复用持久化 profile 里的登录 Cookie，在页面上下文内发起同源请求。
 *
 * 用法：
 *   node scripts/source.js --book 春山不渡               # 全部章节 → .cache/source.json
 *   node scripts/source.js --book 春山不渡 --from 25 --limit 5
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { SRC_URL, fetchChapters } = require('../lib/source');
const { ROOT, CACHE } = require('../lib/common');

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

(async () => {
  const bookTitle = arg('book', '春山不渡');
  const ctx = await chromium.launchPersistentContext(path.join(ROOT, '.profile'), {
    channel: 'chrome',
    headless: true,
    ignoreHTTPSErrors: true,
  });
  let result;
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(SRC_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    result = await fetchChapters(page, {
      bookTitle,
      from: Number(arg('from', 0)),
      to: Number(arg('to', 0)),
      limit: Number(arg('limit', 0)),
    });
  } finally {
    await ctx.close();
  }

  fs.mkdirSync(CACHE, { recursive: true });
  const out = path.join(CACHE, 'source.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');

  if (flag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`《${result.book.title}》 slug=${result.book.slug} 共 ${result.chapters.length} 章`);
    for (const c of result.chapters) {
      console.log(`  第${c.number}章  ${c.title}  (${c.content.length} 字)`);
    }
    console.log(`\n已写入 ${out}`);
  }
})().catch((e) => {
  console.error('[source] 失败：' + e.message);
  process.exit(1);
});
