/* デプロイ用: 配信する静的ファイル(index.html と利用規約・プライバシーポリシー)を dist/ に集める。
   wrangler が dev / deploy の前に自動で実行する([build] command) */
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["index.html", "terms.html", "privacy.html"];

mkdirSync(join(root, "dist"), { recursive: true });
for (const f of FILES) copyFileSync(join(root, f), join(root, "dist", f));
