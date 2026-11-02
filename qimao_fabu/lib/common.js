/**
 * 共享工具：浏览器上下文、选择器配置、日志。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILE = path.join(ROOT, '.profile');
const CACHE = path.join(ROOT, '.cache');
const SELECTORS_FILE = path.join(ROOT, 'references', 'qimao-selectors.json');

const SRC_URL = 'https://127.0.0.1:4317/';
const DST_BOOK_LIST_URL = 'https://zuozhe.qimao.com/front/book-manage';

function loadSelectors() {
  const defaults = {
    newChapterTexts: ['新建章节', '新建', '添加章节', '创建章节', '新增章节', '写新章节'],
    titlePlaceholders: ['章节名', '章节标题', '标题', '请输入章节'],
    bodyHints: ['正文', '内容'],
    saveDraftTexts: ['存草稿', '保存草稿', '保存为草稿', '暂存'],
    saveTexts: ['保存', '确定', '提交'],
    publishTexts: ['发布章节', '发布', '提交审核'],
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(SELECTORS_FILE, 'utf8')) };
  } catch {
    return defaults;
  }
}

async function launch({ headless = true } = {}) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(15000);
  return { ctx, page };
}

/** 页面内点击第一个文本匹配的可见元素 */
async function clickByTexts(page, texts, { timeout = 4000 } = {}) {
  for (const t of texts) {
    for (const scope of [page, ...page.frames().filter((f) => f !== page.mainFrame())]) {
      try {
        const loc = scope.getByText(t, { exact: true }).first();
        if (await loc.count()) {
          await loc.click({ timeout });
          return t;
        }
      } catch {}
      try {
        const loc = scope.getByText(new RegExp(t)).first();
        if (await loc.count()) {
          await loc.click({ timeout });
          return t;
        }
      } catch {}
    }
  }
  return null;
}

async function firstVisible(page, selector) {
  const loc = page.locator(selector);
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

const log = (...a) => console.log('[sync]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 规范化标题用于比对：去空白、全半角、标点差异 */
function normTitle(s) {
  return (s || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？、；：""''（）《》·…—\-,.!?;:()"']/g, '')
    .toLowerCase();
}

module.exports = {
  ROOT,
  PROFILE,
  CACHE,
  SRC_URL,
  DST_BOOK_LIST_URL,
  loadSelectors,
  launch,
  clickByTexts,
  firstVisible,
  log,
  sleep,
  normTitle,
};
