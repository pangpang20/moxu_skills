/**
 * 墨序（源站）API 封装：在已登录页面上下文内发同源请求。
 */
const SRC_URL = 'https://127.0.0.1:4317/';

async function api(page, p) {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { 'content-type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status} @ ${url}`);
    return j;
  }, p);
}

async function resolveBook(page, title) {
  const { books } = await api(page, '/api/books');
  if (!books || !books.length) throw new Error('墨序里没有作品，或登录已失效');
  let book =
    books.find((b) => b.title === title || b.name === title) ||
    books.find((b) => (b.title || b.name || '').includes(title));
  if (!book) {
    const names = books.map((b) => `「${b.title || b.name}」(${b.slug})`).join('、');
    throw new Error(`没找到《${title}》。现有作品：${names}`);
  }
  return book;
}

/** 拉取已定稿章节（标题 + 正文） */
async function fetchChapters(page, { bookTitle, from = 0, to = 0, limit = 0 } = {}) {
  const book = await resolveBook(page, bookTitle);
  const slug = book.slug || book.id;
  const list = await api(page, `/api/books/${encodeURIComponent(slug)}/reader`);
  let chapters = (list.chapters || []).map((c) => Number(c.number));
  if (from) chapters = chapters.filter((n) => n >= from);
  if (to) chapters = chapters.filter((n) => n <= to);
  chapters.sort((a, b) => a - b);
  if (limit) chapters = chapters.slice(0, limit);

  const out = [];
  for (const n of chapters) {
    const d = await api(page, `/api/books/${encodeURIComponent(slug)}/reader/${n}`);
    const ch = d.chapter || d;
    out.push({
      number: Number(ch.number ?? n),
      title: (ch.title ?? '').trim(),
      // 正文在顶层 content，兜底取 chapter.content
      content: (d.content ?? ch.content ?? '').trim(),
    });
  }
  return { book: { title: book.title || book.name, slug }, chapters: out };
}

module.exports = { SRC_URL, api, resolveBook, fetchChapters };
