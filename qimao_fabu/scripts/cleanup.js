#!/usr/bin/env node
/**
 * 草稿清理：按标题删除奇猫草稿箱里的草稿（用于清理测试残留或失败残留）。
 *
 * 用法：
 *   node scripts/cleanup.js --title 测试标题校验          # 预览将删除的草稿
 *   node scripts/cleanup.js --title 测试标题校验 --do     # 确认执行删除
 */
const { chromium } = require('playwright-core');
const path = require('path');
const { ROOT, log, sleep, normTitle } = require('../lib/common');
const { resolveTargetBook } = require('../lib/qimao');

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

(async () => {
  const title = arg('title');
  const dstTitle = arg('dst', '山河不许人间源');
  if (!title) {
    console.error('用法：node scripts/cleanup.js --title <标题关键词> [--dst <七猫书名>] [--do]');
    process.exit(1);
  }
  const key = normTitle(title);

  const ctx = await chromium.launchPersistentContext(path.join(ROOT, '.profile'), {
    channel: 'chrome',
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    const target = await resolveTargetBook(page, dstTitle);
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.el-table__row', { timeout: 20000 });
    await page.getByText('草稿箱', { exact: true }).first().click();
    await sleep(2000);

    const rows = page.locator('.el-table__body-wrapper .el-table__row');
    const n = await rows.count();
    const hits = [];
    for (let i = 0; i < n; i++) {
      const text = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (key && normTitle(text).includes(key)) hits.push(i);
    }
    if (!hits.length) {
      log(`草稿箱中没有标题含「${title}」的草稿。`);
      return;
    }
    log(`匹配 ${hits.length} 条：`);
    for (const i of hits) log('  -', (await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim().slice(0, 80));

    if (!flag('do')) {
      log('预览模式，未删除。加 --do 执行。');
      return;
    }

    // 从后往前删，避免行号漂移
    for (const i of [...hits].reverse()) {
      const row = rows.nth(i);
      await row.getByText('删除', { exact: true }).first().click();
      // 「永久删除」按钮有 2 秒倒计时防误触，等它解锁
      const confirm = page.getByText(/永久删除/).first();
      await confirm.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      for (let t = 0; t < 10; t++) {
        if (await confirm.isEnabled().catch(() => false)) break;
        await sleep(500);
      }
      await confirm.click().catch(() => {});
      await sleep(1500);
      log(`已删除第 ${i + 1} 行草稿`);
    }

    // 删完再读一遍，确认编号状态
    await sleep(1500);
    const rows2 = page.locator('.el-table__body-wrapper .el-table__row');
    const n2 = await rows2.count();
    log(`当前草稿箱 ${n2} 条：`);
    for (let i = 0; i < n2; i++) {
      log('  -', (await rows2.nth(i).innerText()).replace(/\s+/g, ' ').trim().slice(0, 80));
    }
  } finally {
    await ctx.close();
  }
})().catch((e) => {
  console.error('[cleanup] 失败：' + e.message);
  process.exit(1);
});
