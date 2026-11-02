#!/usr/bin/env node
/**
 * 奇猫章节同步：从墨序本地写作台取「已定稿」章节 → 奇猫作者后台新建章节 → 存草稿。
 * 只保存草稿，绝不点击「立即发布 / 定时发布」。
 *
 * 用法：
 *   node scripts/sync.js --count 5              # 同步奇猫缺失的接下来 5 章
 *   node scripts/sync.js --from 25 --to 27      # 指定章节范围
 *   node scripts/sync.js --count 1 --headed     # 有头模式便于观察
 *   node scripts/sync.js --count 1 --dry-run    # 填好但不保存草稿（试运行）
 *
 * 产出：.cache/sync-report.json
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { SRC_URL, fetchChapters } = require('../lib/source');
const { ROOT, CACHE, log, sleep, normTitle } = require('../lib/common');
const { resolveTargetBook } = require('../lib/qimao');

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

const USAGE = `用法：node scripts/sync.js --src <墨序书名> --dst <七猫书名> [--count N | --from N --to M] [--dry-run] [--headed]
  例：node scripts/sync.js --src 春山不渡 --dst 山河不许人间源 --count 5`;

/** 去掉「第12章 / 第十二章」前缀，奇猫会自己加序号 */
function stripPrefix(title) {
  return (title || '')
    .replace(/^第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章节回][\s:：、.]*/, '')
    .trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 正文 → 段落数组（连续换行视为分段，段内不留空行） */
function toParagraphs(content) {
  return content
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 抓当前列表页的所有行文本 */
async function grabRows(page) {
  const out = [];
  const rows = page.locator('.el-table__body-wrapper .el-table__row');
  const n = await rows.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const text = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * 读取奇猫已有章节。
 * 章节管理 → 已发布/审核中的章节（含章号，用于判断"接上哪一章"）
 * 草稿箱   → 已存未发的草稿（无章号，按标题去重，避免重复创建）
 */
async function readExistingChapters(page, bookUrl) {
  await page.goto(bookUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.el-table__row', { timeout: 20000 }).catch(() => {});
  await sleep(1500);

  // 确保最新章在最上面，便于取最大章号
  const desc = page.getByText('倒序', { exact: true }).first();
  if (await desc.count().catch(() => 0)) {
    await desc.click().catch(() => {});
    await sleep(1500);
  }
  const publishedRows = await grabRows(page);

  let draftRows = [];
  const draftTab = page.getByText('草稿箱', { exact: true }).first();
  if (await draftTab.count().catch(() => 0)) {
    await draftTab.click().catch(() => {});
    await sleep(2000);
    draftRows = await grabRows(page);
  }

  return { publishedRows, draftRows };
}

/** 从行文本里解析章号与标题 */
function parseRows(rows) {
  const items = [];
  for (const r of rows) {
    const m = r.match(/第\s*(\d+)\s*章\s*([^\s]*)/);
    if (m) items.push({ order: Number(m[1]), name: (m[2] || '').trim(), raw: r });
  }
  return items;
}

/** 填充正文编辑器：优先 insertText，失败则走剪贴板粘贴 */
async function fillBody(ctx, page, content) {
  const body = page.locator('.chapter-editor .q-contenteditable.edit-mask[contenteditable="true"]').first();
  await body.waitFor({ state: 'visible', timeout: 15000 });
  await body.click();
  await page.keyboard.insertText(content);
  await sleep(800);
  let count = await getWordCount(page);
  if (count >= content.length * 0.6) return { method: 'insertText', count };

  // 回退：剪贴板粘贴（HTML 段落）
  log('insertText 字数异常，改用剪贴板粘贴…');
  await body.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  const paras = toParagraphs(content);
  const html = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://zuozhe.qimao.com' });
  await page.evaluate(
    async ({ html, text }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    },
    { html, text: paras.join('\n') }
  );
  await page.keyboard.press('Control+v');
  await sleep(1500);
  count = await getWordCount(page);
  return { method: 'clipboard', count };
}

async function getWordCount(page) {
  const t = await page.locator('.words-num span').first().innerText().catch(() => '0');
  return Number((t || '0').replace(/\D/g, '')) || 0;
}

(async () => {
  const srcTitle = arg('src', '春山不渡');
  const dstTitle = arg('dst', '山河不许人间源');
  const count = Number(arg('count', 0));
  const from = Number(arg('from', 0));
  const to = Number(arg('to', 0));
  const dryRun = flag('dry-run');
  const headed = flag('headed');

  if (!count && !from && !to) {
    console.error('必须指定 --count N 或 --from/--to，避免一次性全量同步。\n' + USAGE);
    process.exit(1);
  }

  const ctx = await chromium.launchPersistentContext(path.join(ROOT, '.profile'), {
    channel: 'chrome',
    headless: !headed,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(15000);

  const report = { saved: [], skipped: [], failed: [], dryRun };

  try {
    // ---------- 0. 定位七猫目标书 ----------
    const target = await resolveTargetBook(page, dstTitle);
    const bookUrl = target.url;

    // ---------- 1. 奇猫：接上哪一章 ----------
    const { publishedRows, draftRows } = await readExistingChapters(page, bookUrl);
    const published = parseRows(publishedRows);
    const maxOrder = published.reduce((m, e) => Math.max(m, e.order || 0), 0);
    const haystack = normTitle([...publishedRows, ...draftRows].join(' '));
    const titleExists = (t) => {
      const n = normTitle(stripPrefix(t));
      return n.length >= 3 && haystack.includes(n);
    };
    log(
      `奇猫已发布/审核中 ${published.length} 章，最新第 ${maxOrder} 章；草稿 ${draftRows.length} 条 → 从第 ${maxOrder + 1} 章接着上`
    );

    // ---------- 2. 墨序：取待同步章节 ----------
    const srcPage = await ctx.newPage();
    await srcPage.goto(SRC_URL, { waitUntil: 'domcontentloaded' });
    await srcPage.waitForTimeout(1500);
    const { book, chapters } = await fetchChapters(srcPage, { bookTitle: srcTitle, from, to });
    log(`墨序《${book.title}》候选 ${chapters.length} 章`);

    let todo = chapters.filter((c) => {
      if (!from && !to && c.number <= maxOrder) {
        report.skipped.push({ chapter: c.number, reason: `奇猫已到第 ${maxOrder} 章` });
        return false;
      }
      if (titleExists(c.title)) {
        report.skipped.push({ chapter: c.number, reason: '标题已存在（章节或草稿）' });
        return false;
      }
      return true;
    });
    if (!from && !to && count) todo = todo.slice(0, count);
    if (!todo.length) {
      log('没有需要同步的新章节。');
    }

    // ---------- 3. 逐章新建 + 存草稿 ----------
    for (const c of todo) {
      log(`→ 第${c.number}章 ${c.title}`);
      try {
        await page.goto(bookUrl, { waitUntil: 'domcontentloaded' });
        const btn = page.locator('a.create-new-chapter-btn, .create-new-chapter-btn').first();
        await btn.waitFor({ state: 'visible', timeout: 20000 });
        await btn.click();
        await page.waitForSelector('.chapter-name textarea.el-textarea__inner', { timeout: 20000 });
        await sleep(1200);

        // 校验编辑器自动分配的章号，必须和源站一致，避免重号/跳号
        // （编辑器打开即产生云端草稿并占用章号，章号渲染有延迟，需轮询）
        let editorNo = 0;
        for (let i = 0; i < 12; i++) {
          const t =
            (await page.locator('.chapter-index-input-mirror').first().innerText().catch(() => '')) ||
            (await page
              .locator('.chapter-index-input-input input.el-input__inner')
              .first()
              .inputValue()
              .catch(() => ''));
          editorNo = Number((t || '').replace(/\D/g, '')) || 0;
          if (editorNo) break;
          await sleep(500);
        }
        if (!editorNo || editorNo !== c.number) {
          report.failed.push({
            chapter: c.number,
            title: c.title,
            reason: editorNo
              ? `章号对不上：编辑器分配第 ${editorNo} 章 ≠ 源站第 ${c.number} 章，已跳过以免错位`
              : '无法读取编辑器章号，保守起见跳过',
          });
          log(`   ${editorNo ? `章号不符（第${editorNo}章≠第${c.number}章）` : '章号不可读'}，跳过`);
          continue;
        }

        // 标题（≤20 字）
        let title = stripPrefix(c.title).slice(0, 20) || `第${c.number}章`;
        const titleEl = page.locator('.chapter-name textarea.el-textarea__inner').first();
        await titleEl.fill(title);
        const filled = (await titleEl.inputValue().catch(() => '')) || '';
        if (filled !== title) throw new Error(`标题写入校验失败：期望「${title}」实际「${filled}」`);
        if (stripPrefix(c.title).length > 20) {
          log(`   注意：源标题超过 20 字，已截断为「${title}」`);
        }

        // 正文
        const { method, count: words } = await fillBody(ctx, page, c.content);
        log(`   正文已填（${method}，编辑器字数 ${words}）`);

        if (words < 1000) {
          report.failed.push({
            chapter: c.number,
            title,
            reason: `正文仅 ${words} 字，低于奇猫 1000 字下限，未保存`,
          });
          continue;
        }

        if (dryRun) {
          await page.screenshot({ path: path.join(CACHE, `dryrun-${c.number}.png`) });
          await page
            .screenshot({ path: path.join(CACHE, `dryrun-title-${c.number}.png`), clip: { x: 0, y: 55, width: 820, height: 100 } })
            .catch(() => {});
          report.saved.push({ chapter: c.number, title, words, note: 'dry-run 未保存' });
          continue;
        }

        // 存草稿（绝不点发布）
        await page.locator('a.qm-btn', { hasText: '更新草稿' }).first().click();
        await sleep(2500);
        const status = await page
          .locator('.save-status .text')
          .first()
          .innerText()
          .catch(() => '');
        report.saved.push({ chapter: c.number, title, words, status });
        log(`   已存草稿（${status || '状态未知'}）`);
      } catch (e) {
        const shot = path.join(CACHE, `fail-${c.number}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        report.failed.push({ chapter: c.number, title: c.title, reason: e.message, shot });
        log(`   失败：${e.message}`);
      }
    }
  } finally {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, 'sync-report.json'), JSON.stringify(report, null, 2), 'utf8');
    await ctx.close();
  }

  console.log('\n========== 同步报告 ==========');
  for (const s of report.saved) console.log(`✔ 第${s.chapter}章 ${s.title} (${s.words}字) ${s.note || ''}`);
  const skipByReason = {};
  for (const s of report.skipped) {
    skipByReason[s.reason] = (skipByReason[s.reason] || 0) + 1;
  }
  for (const [reason, n] of Object.entries(skipByReason)) console.log(`↷ 跳过 ${n} 章：${reason}`);
  for (const f of report.failed) console.log(`✘ 第${f.chapter}章 失败：${f.reason}`);
  console.log(`保存 ${report.saved.length} · 跳过 ${report.skipped.length} · 失败 ${report.failed.length}`);
  if (report.failed.length) process.exit(2);
})().catch((e) => {
  console.error('[sync] 总体失败：' + e.message);
  process.exit(1);
});
