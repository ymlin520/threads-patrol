// ── 貼文篩選：排除雷區、辨識徵集文、過濾太舊的貼文 ──────────────────
// 三個平台（Threads / IG / FB）共用，海巡端與通知端都會用到。

// 貼文超過幾天就不回（IG 搜尋頁會回 2017 年的老貼文，回那種沒有意義）
// posted_at 是空字串（抓不到日期，FB 常見）時不套用這條，以免整批被誤殺。
export const MAX_AGE_DAYS = 90;

// ── 雷區：出現這些字就完全不回 ────────────────────────────
// 這類貼文多半是申訴、糾紛、負評、爆料。用溫暖的美食稿去回會非常失禮。
export const EXCLUDE_KEYWORDS = [
  "避雷", "踩雷", "雷店", "地雷店", "超雷",
  "申訴", "糾紛", "客訴", "退費", "退款", "求償", "提告", "法院",
  "詐騙", "被騙", "爆料", "抵制", "勸退", "黑店", "奧客",
  "食物中毒", "吃到蟑螂", "吃到頭髮", "不衛生", "衛生很差", "衛生堪憂",
  "態度很差", "態度超差", "服務態度差", "難吃到", "超難吃",
  "不要去", "別去", "不推薦", "不建議去",
  "出格", "惡劣", "受害", "欺騙", "檢舉", "恐嚇", "騷擾", "求擴散", "幫高調",
];

// ── 徵集文：不是分享店家，而是在跟大家要推薦 ─────────────────
// 這種其實最好回（回了很容易被看見），但要用不同語氣：
// 不能回「這間我收進口袋名單了」——貼文裡根本沒有「這間」。
export const SOLICIT_KEYWORDS = [
  "有沒有推薦", "有推薦嗎", "有推薦的", "求推薦", "跪求", "推薦一下",
  "一人交出", "交出你", "一人說一個", "一人一間", "蓋樓", "蓋一個",
  "求解答", "求評論", "有人吃過", "有沒有人", "有誰知道",
  "不知道要吃什麼", "不知道要去哪", "大家都去哪", "求救",
];

const hasAny = (text, words) => words.find((w) => text.includes(w)) || null;

/**
 * 檢查一篇貼文，回傳篩選旗標。
 * @param {{content?:string, posted_at?:string}} post
 * @param {{maxAgeDays?:number, now?:number}} opts
 * @returns {{excluded:boolean, exclude_reason:string, solicit:boolean, age_days:number|null}}
 */
export function screenPost(post, opts = {}) {
  const maxAgeDays = opts.maxAgeDays ?? MAX_AGE_DAYS;
  const now = opts.now ?? Date.now();
  const text = post.content || "";

  // 1. 雷區字詞
  const bad = hasAny(text, EXCLUDE_KEYWORDS);

  // 2. 太舊（抓不到日期就不判定）
  let ageDays = null;
  const t = post.posted_at ? Date.parse(post.posted_at) : NaN;
  if (!Number.isNaN(t)) ageDays = Math.floor((now - t) / 86400000);
  const tooOld = ageDays !== null && ageDays > maxAgeDays;

  // 3. 徵集文（只做標記，不排除）
  const solicit = Boolean(hasAny(text, SOLICIT_KEYWORDS));

  return {
    excluded: Boolean(bad) || tooOld,
    exclude_reason: bad ? `雷區字詞：${bad}` : tooOld ? `太舊：${ageDays} 天前` : "",
    solicit,
    age_days: ageDays,
  };
}

/**
 * 整批檢查。除了逐篇 screenPost，再加一條「同作者連坐」：
 * 申訴文常常是連載（第一篇寫「避雷」、第二篇只寫經過），只擋到其中一篇沒有用。
 * 只要同一批裡有一篇踩到雷區字詞，該作者其餘貼文一併排除。
 * @param {Array<{content?:string, posted_at?:string, author?:string}>} posts
 * @returns {Array<ReturnType<typeof screenPost>>} 與 posts 等長、同順序
 */
export function screenBatch(posts, opts = {}) {
  const results = posts.map((p) => screenPost(p, opts));

  const badAuthors = new Set();
  posts.forEach((p, i) => {
    if (p.author && results[i].exclude_reason.startsWith("雷區字詞")) badAuthors.add(p.author);
  });

  return results.map((r, i) => {
    const author = posts[i].author;
    if (r.excluded || !author || !badAuthors.has(author)) return r;
    return { ...r, excluded: true, exclude_reason: `同作者有雷區貼文：${author}` };
  });
}
