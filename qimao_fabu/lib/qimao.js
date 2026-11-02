/**
 * 七猫侧工具：按书名定位作品管理页。
 * 路径：作品列表(/front/book-manage) → 找到书名匹配的卡片 → 点「管理」→ 拿到 manage?id=xxx
 * 结果缓存到 .cache/target-books.json，避免每次都点页面。
 */
const fs = require('fs');
const path = require('path');
const { CACHE, DST_BOOK_LIST_URL, log, sleep } = require('./common');

const CACHE_FILE = path.join(CACHE, 'target-books.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeCache(data) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 解析书名 → { id, title, url }
 * @param {import('playwright-core').Page} page 已登录的七猫页面
 * @param {string} bookTitle 书名（可带《》）
 * @param {object} [opts] refresh=true 时忽略缓存重新解析
 */
async function resolveTargetBook(page, bookTitle, { refresh = false } = {}) {
  const clean = bookTitle.replace(/[《》\s]/g, '');
  const cache = readCache();
  if (!refresh && cache[clean]) return cache[clean];

  log(`正在七猫作品列表定位《${bookTitle}》…`);
  await page.goto(DST_BOOK_LIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 左侧分类（小说/短故事/剧本），默认点「小说」
  const nav = page.getByText('小说', { exact: true }).first();
  if (await nav.count().catch(() => 0)) {
    await nav.click().catch(() => {});
    await sleep(2500);
  }

  const clicked = await page.evaluate((title) => {
    const cards = [...document.querySelectorAll('div,li,article,section')].filter((el) => {
      const t = el.innerText || '';
      if (!t.includes(title)) return false;
      return [...el.querySelectorAll('a,span,div,button')].some((x) => (x.innerText || '').trim() === '管理');
    });
    if (!cards.length) return false;
    cards.sort((a, b) => a.innerText.length - b.innerText.length);
    const btn = [...cards[0].querySelectorAll('a,span,div,button')].find((x) => (x.innerText || '').trim() === '管理');
    btn.click();
    return true;
  }, clean);

  if (!clicked) {
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('div,li,article,section')]
        .filter((el) => /最新章节|本月更新/.test(el.innerText || ''))
        .map((el) => (el.innerText || '').split('\n')[0])
        .slice(0, 10)
    );
    throw new Error(
      `七猫作品列表里没找到《${bookTitle}》。` +
        (names.length ? `现有作品：${[...new Set(names)].join('、')}` : '（也可能未登录或页面改版）')
    );
  }

  await page.waitForURL(/book-manage\/manage\?id=\d+/, { timeout: 15000 });
  const id = (page.url().match(/id=(\d+)/) || [])[1];
  if (!id) throw new Error('点击「管理」后未拿到书籍 id，页面可能已改版');
  const info = { id, title: clean, url: page.url(), resolvedAt: new Date().toISOString() };
  cache[clean] = info;
  writeCache(cache);
  log(`已定位《${clean}》 id=${id}`);
  return info;
}

module.exports = { resolveTargetBook };
