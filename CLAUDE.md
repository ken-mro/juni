# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「FLICK IMPACT」（旧称: 十二 JŪNI。リポジトリ名・localStorage キーは `juni` のまま）— フリック入力で落下する「ことばの隕石」を破壊するスマホ向けタイピングゲーム。**1プレイ = 1レベル**で、60秒以内に規定数を撃破すればクリア。成績は**クリアタイム**（短いほど良い）。仕様の原典は [spec.md](spec.md)。ゲーム本体は **index.html 一枚**で完結する。公開URLは **https://flick-impact.com**（Cloudflare Workers。`worker/index.js` が配信・Google ログイン・プレイデータ保存を担う。セットアップ手順は [README.md](README.md)）。

## 絶対に守る制約

- **単一HTMLファイル**。CSS/JSすべてインライン。外部依存ゼロ（CDN・npm・ビルドツール・音源ファイル不可。音はWeb Audio APIで合成、共有画像も canvas で描く）
- 入力は **Pointer Events で統一**（`touchstart` 禁止）。マウスでも同じコードパスが通る
- 調整用の数値はファイル先頭に集約: レイアウト系・DOMの色は CSS `:root` のカスタムプロパティ、ゲームプレイ系は `<script>` 先頭の `CONFIG`、canvas の描画色は `PALETTE`。関数内にマジックナンバー・色コードを埋めない
- 配信先は Cloudflare Workers（`flick-impact.com`）。静的アセットとして `index.html` を配信し、`/auth/*` `/api/*` だけ Worker が処理する。`index.html` はバックエンド無し（GitHub Pages など）でも壊れない（`/api/me` が JSON を返さなければクラウド同期の UI を出さない）
- **Google ログインは Worker 側で完結させる**（Authorization Code + PKCE）。HTML に Google のスクリプトを読み込まない。取得するのは表示名だけ（スコープ `openid profile`）
- Worker も外部依存ゼロ（npm パッケージ不使用・ES module 一本）。調整値は `worker/index.js` 先頭の `SETTINGS`、秘密情報は `wrangler secret`（`GOOGLE_CLIENT_SECRET` / `SESSION_SECRET`）。ファイルに秘密を書かない
- `localStorage` は使用可

## 動作確認の方法

ビルド不要。ローカルHTTPサーバーで配信して確認する:

```powershell
python -m http.server 8321 --directory c:\Source\Repos\juni
```

ログイン・クラウド同期まで確認するときは Worker ごと動かす（KV はローカル保存。秘密情報は git 管理外の `.dev.vars`）:

```powershell
npx wrangler dev --port 8787 --ip 127.0.0.1 --local-upstream 127.0.0.1:8787
```

- `--local-upstream` が無いと wrangler が独自ドメイン設定を読み、Google へ渡すリダイレクト先が本番URLになる
- Google の同意画面はローカルでは通せない。ログイン済み状態は `.dev.vars` の `SESSION_SECRET` で署名した `fi_session` Cookie（`base64url(JSON{sub,name,exp}) + "." + base64url(HMAC-SHA256)`）を Playwright の `addCookies` で入れて再現する

- ブラウザ確認は **http://127.0.0.1:8321** を使う。**localhost（::1）は使わない** — この開発機ではIPv6ループバックが途中で接続リセットされ、ページが読み込み途中で固まる
- 実機（スマホ）は同一Wi-FiからPCのLAN IP（例 http://192.168.3.4:8321）で開く
- 自動確認は Playwright MCP を使用。`page.mouse` の down/move/up でフリックを再現できる。ブラウザウィンドウが背面にあると rAF が約1fpsに間引かれ「隕石が動かない」ように見える点に注意（`update(dt)` を直接呼ぶ決定的テストが確実。撃破は `handleGameInput(expectedToken(meteors[0]))` を繰り返す）
- 各変更後はコンソールエラーがないことまで確認してから完了報告する。確認用スクリーンショットをリポジトリに残さない

## アーキテクチャ（index.html 内の構成順）

1. **CSS**: `:root` トークン（縦配分 `--pad-h`、開始レベル選択の寸法 `--lv-*`、パレット。基調は「ビビッドな宇宙」= 深い紫 `--bg-deep` × 星の黄 `--ember: #ffd93d`、副アクセントに `--cyan` / `--pink`。明朝体は日本語の見出し（一時停止・設定・記録など）のみ。ロゴ・ドット文字関連は `--logo-*` / `--pixel-*`）。オーバーレイは `.modal` / `.panel` を共用
2. **CONFIG / PALETTE / COST**: 全調整値。`FLICK_THRESHOLD`、`TIME_LIMIT`（60秒）、`CLEAR_RATIO`（規定数係数）、落下・出現カーブ、`RANKS`（クリアタイムのしきい値）、共有画像サイズ、音量など。`PALETTE.SKY` はレベル別の空の色、`PALETTE.SHARE_*` は共有画像の色。続けて **ドット文字** `LOGO`（段・字間・影・グラデーションのCSS変数名）、`PIXEL_HEADINGS`（CLEAR! / TIME UP / RANK の文言と塗り）、`PIXEL_FONT`（高さ7・2ドット幅の太字ドットフォント。英大文字・数字・`!` `.` 空白）
3. **入力データ**: `KEY_LAYOUT`（3×4キー）、`FLICK_MAP`（キー行→[中央,左,上,右,下]、nullは無反応）、`CYCLES`（小゛゜の変換循環 か→が、は→ば→ぱ、つ→っ→づ）
4. **単語データ `WORDS`**: `"よみ|表記"` 形式のベタ書き（約600語、宇宙系2割。レベル別プールの順に並べてある）。起動時に `validateReading`（不正文字・`METEOR_MAX_LEN` 超え・語頭の ん/を/ー/小文字）と読みの重複を検査し、不正語は `console.warn` してスキップ。かなの網羅状況（未出現のかな・語頭に立たない清音）を `console.info` で報告する。各語に `first`（先頭のひらがな）と `firstToken`（先頭の入力トークン）を付与
5. **語彙モジュール**: `toBase` / `rowOf` / `extraCost` / `analyze`（`actions`=実フリック回数が難易度基準）
6. **レベル**: `LEVELS`（行の解放が難易度の主軸）と `CONFIG.LEVEL_LEN`（読みの文字数の範囲。最小は常に2、最大がレベルごとに1文字ずつ増え、L1 は2文字だけ、L6 以降は制限なし）の両方で絞った `LEVEL_POOLS`（起動時確定。`poolIndex(level)` で引く）。`speedScale(level)` / `spawnScale(level)` / `spawnIntervalFor(level)` / `requiredKills(level)` / `lenRange(level)` はレベルを引数に取る純関数。L6以降は速度と出現頻度が上がり続け、規定数も増える
7. **ドット文字**: `pixelRuns(lines)` が `PIXEL_FONT` から文字列（複数行・中央揃え）のドット配置（横連続をまとめた矩形）を作る。`buildPixelSvg(lines, fill, className)` は DOM 用の SVG 文字列（影＋グラデーション。`fill` は CSS 変数名の配列か `"currentColor"`）、`buildLogoSvg()` はそのロゴ版。`drawPixelText()` は canvas（共有画像）へ同じ配置を描く。使用箇所: HUD・タイトルのロゴ、スタート直後の READY / GO!（`#countdown`）、リザルト見出し（CLEAR! / TIME UP）、RANK とランク文字（リザルト・記録一覧・共有画像）、共有画像の LEVEL n CLEAR。favicon は `<head>` の data URI（SVG: 左下の地球へ「あ」の隕石が落ちてくる）
8. **canvas ゲーム**: 隕石・破片・浮遊テキスト（撃破語の表記 / COMBO / ラスト10秒 / -1）の描画と `requestAnimationFrame` + `dt` 駆動の `update`/`draw`。空の色は `sky` がレベルの色へなじむ。着地時は `shake` で全体を揺らす。下端には地球の地平線 `drawEarth()`（装飾。高さ `CONFIG.EARTH_H` は `--earth-h` として `#chip` の位置にも使う）があり、正しい入力のたびに地球の頂点から隕石へビーム `fireBeam()` / `drawBeams()` が走る。ロック中の隕石は最後に描いて最前面にし、岩の色を `PALETTE.METEOR_*_LOCK` に変える。記録更新の紙吹雪 `confetti` はモーダルより上の全画面 `#fx` canvas（`drawFx()`）に描く
9. **SFX / BGM**: Web Audio合成。AudioContext は SFX に1つだけ生成し `SFX.context()` で BGM と共有。**初回のユーザー操作（スタートボタン/キータッチ）でしか起動できない**。BGM はチップチューン（`MELODY`/`CHORDS` を先読みスケジューラで予約。テンポはレベルとラストスパートで上がる）。隠しステージは専用曲 `SECRET_MELODY`/`SECRET_CHORDS`/`SECRET_BASS`（3拍子。1小節=8分×6）を `style: "waltz"`（2・3拍の和音刻み・タンバリン・8分の高いアルペジオ・リードにビブラート）で鳴らす。曲とアレンジは `SONGS`（`beats` が拍数）/ `STYLE`、選択は `song()`（`game.secret` で切り替え）
10. **ゲーム状態・入力・UI配線**: `game`（`timeLeft`/`level`/`destroyed`/`required`/`combo`）、統計 `stats`、記録 `juni.records`、`showResult(rec, mode)`（clear / fail / view の3モード）、`finishGame(cleared)`、`startLevel(level)`（READY → GO! の `countdown` を仕込み、`updateCountdown(dt)` が `CONFIG.READY_TIME` + `GO_TIME` 秒後に `beginPlay()` で `game.started = true` と BGM 開始）、開始レベル選択、記録一覧、共有画像 `buildShareImage` / `shareResult`
11. **隠しステージ「ファーストコンタクト」**（`finishSecret` / `startSecret` / `drawUfo` / `drawBubble`）: `CONFIG.SECRET_EVERY`（5）の倍数のレベルをクリアしたリザルトにだけ「?」ボタン `#go-secret` が出る。押すと説明モーダル `#secret-intro`（遊び方・スタート・タイトルへ。見出しは `PIXEL_HEADINGS.SECRET_INTRO` の2段ドット文字）を出し、「スタート」で `startSecret(level)` = `startLevel(level, { secret: true })` で `game.secret = true` のまま同じレベルの語彙・出現間隔・規定数で始まる。隕石の代わりに UFO の宇宙人が降らせる「ふきだし」を打ち返し、友好度 `secretPct()` = 撃破数 / 規定数（%）を上げる。1語打ち終えるとハート（floater `heart`）が UFO へ飛び、宇宙人の表情が `CONFIG.SECRET_FACE_STEPS` で変わる。終了は「友好度 100%」か時間切れで、失敗は無い。リザルトは `showResult(rec, "secret")`（見出し THANK YOU、友好度%、ランク・共有・次のレベル無し、「もう一度」= `startSecret` で再開、「タイトルへ」）。「?」ボタンは「次のレベルへ」の上
12. **クラウド同期 `Cloud`**（記録セクションの直後）: `init()`（起動時に `/api/me` → ログイン中なら `pull()`）、`pull()`（サーバーと手元を `mergeData` で統合して `apply()`）、`push()`（`PUT /api/data`。差分がなければ送らない）、`schedulePush()`（`CLOUD.PUSH_DELAY` 秒待ってまとめる）。`saveRecords` / `saveSettings` は `markLocalChange()` を通る。タイトル画面下部の `#cloud` にログイン導線と状態を表示

### バックエンド `worker/index.js`（Cloudflare Worker）

- `GET /auth/google/start` → Google へ（state と PKCE verifier を短命 Cookie `fi_oauth` に）→ `GET /auth/google/callback` でコード交換・ID トークン検証（aud / iss / exp）→ セッション Cookie `fi_session` を発行して `/?auth=ok` へ。失敗は `/?auth=error&reason=…`
- `POST /auth/logout`、`GET /api/me`、`GET /api/data`、`PUT /api/data`。状態を変える要求は `Origin` が同一オリジンのときだけ受ける
- KV `PLAYDATA` のキー `user:<sub>` に `{ records, settings, updatedAt, savedAt }`。`PUT` はサーバー側でも統合してから保存し、統合結果を返す
- `www.` は `CANONICAL_HOST` へ 301。それ以外のパスは `env.ASSETS`（`dist/index.html`。`worker/build.mjs` が作る）

## 重要な設計判断（変更時に壊しやすい不変条件）

- **`FLICK_MAP` が唯一の真実**。かな→行の対応（`KANA_ROW`）、語彙バリデーション、次キーヒントはすべてここから導出される。キー配置を変えるときは他を触らない
- **入力の展開モデル**: 各文字は実際の打鍵列に展開される（が=[か,゛]、ぱ=[は,゛,゛]、っ=[つ,゛]）。展開は `CYCLES` の位置から決まる。一方スコア用の `COST`（濁1/半濁2/小1）は仕様の規定値で、実打鍵数と一致しない文字（づ）があるが**仕様が優先**
- **ターゲティング**: 最初に一致した入力で隕石にロックされ、破壊・着地まで対象は変わらない。出題時は場の隕石と先頭入力トークンが重複しない語を選ぶ（表示文字でなくトークン基準）
- **出題規則**（`pickWord`）: 候補をフィルタして一様に選ぶ。第1候補は「語頭のひらがな（が≠か）が直近 `RECENT_FIRST_KANA` 語に出ていない ∧ 場内トークン重複なし ∧ 同じ語が直近 `RECENT_WORDS` 語に出ていない」。以降、同じ語→語頭の順に条件を緩め、場内重複回避だけは最後まで残す。語頭を避ける語数は `LEVEL_FIRST_LIMIT[i] = clamp(RECENT_FIRST_KANA, 1, プールの語頭種類数 − FIRST_KANA_SLACK)`（L1 は 13、L2 以降 20）。語彙を減らすときや `LEVEL_LEN` の文字数範囲を変えるときはこの前提（L2 以降で語頭 22 種以上）を壊さない（起動時の `console.log` でプールの語数と語頭回避数を確認できる）
- **canvas/DOM の境界**: フィールドのみ canvas（座標はCSSピクセル、dprは `setTransform` で吸収）。キーパッド・HUD・オーバーレイ・フリックガイドは DOM。着地の判定線は canvas 下端そのもの（座標変換なし）
- **1プレイ = 1レベル（固定）**。終了条件は「`destroyed >= required` でクリア」か「`TIME_LIMIT` の時間切れ」の2つだけ。ライフもスコアもない
- **規定数** `requiredKills(level) = max(1, round(TIME_LIMIT / spawnIntervalFor(level) * CLEAR_RATIO))`。出現間隔を変えると規定数も変わる
- **着地は撃破数 −1**（0未満にならない）＋コンボリセット＋揺れ。ミス入力はコンボリセットのみ
- **隠しステージは平和**: ビーム・爆発・危険ライン・揺れ・減点が無い（ふきだしの着地は「…？」と消えてコンボが切れるだけ）。`game.level` はクリアしたレベルのまま（`settings.startLevel` は変えない）で、`juni.records` には何も書かない（`maxClearedLevel()` と解放上限に影響しない）。結果はベスト友好度 `settings.secretBest`（0〜100）だけを更新し、記録一覧の末尾に「？？？」行として出す。隠しステージから戻る先はタイトルだけ
- **場の補充**: 隕石が `METEOR_MIN` 未満なら出現間隔を待たずに補充する（`SPAWN_MIN_GAP` は空ける）。速く撃破するほど早くクリアできる根拠
- **開始レベル**: 解放上限 = `maxClearedLevel() + 1`（上限なし）。選択肢は最低 `START_LEVEL_SHOWN` 個、解放が超えたぶんだけ増え、枠(`--lv-rows` 段)内でスクロール。`startLevel(level)` は `settings.startLevel` も更新する
- **記録**: クリア時のみ更新。`juni.records[level]` はベストタイム更新（初クリア含む）のときだけ丸ごと置き換える。時間切れは記録に触れない。行別正答率の ↑↓ は同レベルの前ベストとの比較
- **リザルトの遷移**: クリア「次のレベルへ」と時間切れ「もう一度」は `startLevel()` で開始（タイトルを経由しない。READY → GO! の間は `game.started` が false で、隕石・タイマー・入力すべて止まっている）。「タイトルへ」と一時停止「やり直す」は `goToTitle()`。記録閲覧（view）の「閉じる」はオーバーレイを閉じるだけ（下にタイトルが残っている）
- **ドット文字は1か所のデータから**: ロゴも英字見出しもすべて `PIXEL_FONT` から描く。`PIXEL_FONT` にない文字は空白として描かれる（日本語は描けない。日本語の見出しは明朝体のまま）。ロゴの文字を変えるときは `LOGO.LINES` を、見出しの文言は `PIXEL_HEADINGS` を変える。HUD の幅は2段構成が前提（狭い端末は `--logo-hud-h-narrow` で縮める）
- **共有画像**: `buildShareImage(rec)` は 1080×1080 の canvas を返す純関数。`shareResult()` は Web Share API（`navigator.canShare({files})`）→ 失敗/非対応なら `#share` に `<img>` とダウンロードリンクを出す
- **localStorage キー**: `juni.records` / `juni.settings`（guide, hint, sfx, bgm, startLevel, secretBest）/ `juni.sync`（`{ updatedAt }` 手元の記録・設定を最後に変えた時刻）。旧 `juni.best` / `juni.highscore` / `juni.history` と `settings.easy` / `settings.practice` は読まない
- **クラウド同期の統合規則**（端末側 `Cloud.mergeData` とサーバー側 `mergeData` で同一）: 記録はレベルごとに**タイムが短いほう**、設定は **`updatedAt` が新しいほう**（ただし `settings.secretBest` は端末側で**高いほう**を取る。サーバーは設定を丸ごと扱うので変更不要）。サーバーから受け取ったデータの書き戻し中は `applyingCloud` で「手元の変更」扱いにしない（無限に押し返さないため）。プレイ中は設定を書き戻さない（音やヒントが途中で変わらないように）
- **ログインは任意**。未ログイン・バックエンド無しでも従来どおり localStorage だけで動く。ログアウトしても手元の記録は消さない

## 進め方（このリポジトリでの合意事項）

- 機能はフェーズ単位で実装し、**ブラウザで動作確認できる状態にしてから**ユーザーの実機確認を待つ
- 完了報告の前に必ず動作検証を行い、証拠（検証結果）を添える
