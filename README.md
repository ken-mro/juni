# FLICK IMPACT

フリック入力で落下する「ことばの隕石」を破壊するスマホ向けタイピングゲーム。
ゲーム本体は `index.html` 一枚（外部依存ゼロ）。仕様は [spec.md](spec.md)、開発の約束事は [CLAUDE.md](CLAUDE.md)。

- 公開URL: **https://flick-impact.com**（Cloudflare Workers）
- Google でログインすると記録・設定がサーバーに保存され、別の端末でも引き継げる（任意。ログインしなくても遊べる）

## 構成

| パス | 役割 |
| --- | --- |
| `index.html` | ゲーム本体。バックエンドが無い配信先（GitHub Pages など）でもそのまま動く（ログイン欄が出ないだけ） |
| `worker/index.js` | Cloudflare Worker。`index.html` の配信、Google ログイン（`/auth/*`）、プレイデータ API（`/api/*`） |
| `worker/build.mjs` | 配信ファイル（`index.html` のみ）を `dist/` に集める。wrangler が dev / deploy の前に自動実行 |
| `wrangler.toml` | Worker の設定（独自ドメイン・KV・環境変数） |
| `.github/workflows/deploy.yml` | `main` に push すると Cloudflare へデプロイ |

### データの流れ

```
[スマホ] index.html ──GET /api/me──▶ Worker ── ログイン状態(Cookie の署名検証)
        ──GET/PUT /api/data──▶ Worker ──▶ KV  user:<Google の sub> = { records, settings, updatedAt }
        ──/auth/google/start──▶ Google 同意画面 ──▶ /auth/google/callback ──▶ /（Cookie 発行）
```

- HTML 側は Google のスクリプトを読み込まない。ログインは `/auth/google/start` への画面遷移だけで、コードとトークンの交換は Worker がサーバー側で行う（Authorization Code + PKCE）
- セッションは HMAC 署名付きの HttpOnly Cookie（90日）。サーバー側にセッション表は持たない
- 統合規則: 記録はレベルごとに**タイムが短いほう**、設定は**更新が新しいほう**。端末側・サーバー側の両方で同じ規則を適用するので、複数端末で同時に遊んでも記録は失われない
- 要求するスコープは `openid profile`（表示名のみ。メールアドレスは取得しない）

## 初回セットアップ

### 1. Google OAuth クライアントを作る

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIとサービス → OAuth 同意画面**: ユーザーの種類「外部」、アプリ名 FLICK IMPACT、スコープは `openid` と `.../auth/userinfo.profile` のみ
   - 公開ステータスが「テスト」のままだとテストユーザー以外はログインできない。一般公開するときは**「本番環境に公開」**にする（要求スコープが上記だけなら審査不要）
3. **認証情報 → 認証情報を作成 → OAuth クライアント ID**: 種類「ウェブ アプリケーション」
   - 承認済みのリダイレクト URI:
     - `https://flick-impact.com/auth/google/callback`
     - `http://127.0.0.1:8787/auth/google/callback`（ローカル開発用）
4. 表示された**クライアント ID** を `wrangler.toml` の `GOOGLE_CLIENT_ID` に書く。**クライアント シークレット**は次の手順で secret として登録する（ファイルに書かない）

### 2. Cloudflare 側を用意する

前提: `flick-impact.com` が Cloudflare のアカウントにゾーンとして登録済み（ドメインを Cloudflare で購入していれば済んでいる）。

```powershell
npx wrangler login

# プレイデータの保存先(KV)。表示された id を wrangler.toml の [[kv_namespaces]] に貼る
npx wrangler kv namespace create PLAYDATA

# 秘密情報(値は対話的に入力)
npx wrangler secret put GOOGLE_CLIENT_SECRET   # Google のクライアント シークレット
npx wrangler secret put SESSION_SECRET         # Cookie 署名用の乱数。例: openssl rand -base64 32

# デプロイ(独自ドメインの DNS レコードも自動で作られる)
npx wrangler deploy
```

- DNS の `flick-impact.com` / `www` に既存のレコード（購入直後のパーキング用 A レコードなど）があると「record already exists」で止まる。Cloudflare ダッシュボードの DNS からそのレコードを消して再実行する
- `www.flick-impact.com` は Worker が `flick-impact.com` へ 301 で転送する（`CANONICAL_HOST`）

### 3. GitHub Actions で自動デプロイ

リポジトリの **Settings → Secrets and variables → Actions** に登録:

| Secret | 値 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare ダッシュボード → My Profile → API Tokens →「Cloudflare Workers を編集する」テンプレートで作成 |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages の画面右側に表示されるアカウント ID |

以後は `main` に push すると `.github/workflows/deploy.yml` がデプロイする（`index.html` / `worker/` / `wrangler.toml` の変更時）。

## ローカル開発

ゲームだけを見るなら従来どおり静的サーバーで足りる（ログイン欄は出ない）:

```powershell
python -m http.server 8321 --directory c:\Source\Repos\juni
# http://127.0.0.1:8321
```

ログイン・同期まで確認するときは Worker ごと動かす:

```powershell
# 秘密情報は .dev.vars(git 管理外)に書く
#   GOOGLE_CLIENT_SECRET=...
#   SESSION_SECRET=...
npx wrangler dev --port 8787 --ip 127.0.0.1 --local-upstream 127.0.0.1:8787
# http://127.0.0.1:8787  (KV はローカルの .wrangler/ に保存される)
```

`--local-upstream` を付けないと、wrangler が独自ドメインの設定を読んで Worker に `flick-impact.com` 宛てとして見せるため、Google へ渡すリダイレクト先が本番の URL になってしまう。

## localStorage

| キー | 内容 |
| --- | --- |
| `juni.records` | レベルごとのベスト記録 |
| `juni.settings` | 設定（guide, hint, sfx, bgm, startLevel） |
| `juni.sync` | `{ updatedAt }` 手元の記録・設定を最後に変えた時刻（設定の新旧比較に使う） |
