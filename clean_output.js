// 就地清洗現有輸出檔的亂碼／特殊符號（不動 CSV 結構、BOM、換行、中文、emoji）
// 用法：node clean_output.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 只移除亂碼字元：方塊/框線 ─▓▒░、￼ 物件字元、� 取代字元、零寬字元(不含檔首 BOM)
const JUNK = /[─-▟￼�​-‍]/g;

const targets = [
  path.join(__dirname, "replies_draft.json"),
  ...fs.readdirSync(path.join(__dirname, "output"))
    .filter((f) => f.endsWith(".csv") || f.endsWith(".json"))
    .map((f) => path.join(__dirname, "output", f)),
];

let total = 0;
for (const f of targets) {
  if (!fs.existsSync(f)) continue;
  const before = fs.readFileSync(f, "utf8");
  const after = before.replace(JUNK, "");
  const removed = before.length - after.length;
  if (removed > 0) { fs.writeFileSync(f, after, "utf8"); total += removed; }
  console.log(`${removed > 0 ? "✔ 清掉 " + removed + " 個亂碼字" : "－ 乾淨"} : ${path.basename(f)}`);
}
console.log(`──── 共移除 ${total} 個亂碼／特殊字元 ────`);
