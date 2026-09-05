/* デプロイ用: 配信する静的ファイル(index.html のみ)を dist/ に集める。
   wrangler が dev / deploy の前に自動で実行する([build] command) */
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist"), { recursive: true });
copyFileSync(join(root, "index.html"), join(root, "dist", "index.html"));
