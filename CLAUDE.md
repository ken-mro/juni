# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「FLICK IMPACT」（旧称: 十二 JŪNI。リポジトリ名・URL・localStorage キーは `juni` のまま）— フリック入力で落下する「ことばの隕石」を破壊するスマホ向けタイピングゲーム。**1プレイ = 1レベル**で、60秒以内に規定数を撃破すればクリア。成績は**クリアタイム**（短いほど良い）。仕様の原典は [spec.md](spec.md)。実装は **index.html 一枚**で完結する。

## 絶対に守る制約

- **単一HTMLファイル**。CSS/JSすべてインライン。外部依存ゼロ（CDN・npm・ビルドツール・音源ファイル不可。音はWeb Audio APIで合成、共有画像も canvas で描く）
- 入力は **Pointer Events で統一**（`touchstart` 禁止）。マウスでも同じコードパスが通る
- 調整用の数値はファイル先頭に集約: レイアウト系・DOMの色は CSS `:root` のカスタムプロパティ、ゲームプレイ系は `<script>` 先頭の `CONFIG`、canvas の描画色は `PALETTE`。関数内にマジックナンバー・色コードを埋めない
- 配信先は GitHub Pages（静的）。`localStorage` は使用可

## 動作確認の方法

ビルド不要。ローカルHTTPサーバーで配信して確認する:

```powershell
python -m http.server 8321 --directory c:\Source\Repos\juni
```

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
6. **レベル**: `LEVELS`（行の解放が難易度の主軸）と `LEVEL_POOLS`（起動時確定）。`speedScale(level)` / `spawnScale(level)` / `spawnIntervalFor(level)` / `requiredKills(level)` はレベルを引数に取る純関数。L6以降は速度と出現頻度が上がり続け、規定数も増える
7. **ドット文字**: `pixelRuns(lines)` が `PIXEL_FONT` から文字列（複数行・中央揃え）のドット配置（横連続をまとめた矩形）を作る。`buildPixelSvg(lines, fill, className)` は DOM 用の SVG 文字列（影＋グラデーション。`fill` は CSS 変数名の配列か `"currentColor"`）、`buildLogoSvg()` はそのロゴ版。`drawPixelText()` は canvas（共有画像）へ同じ配置を描く。使用箇所: HUD・タイトルのロゴ、リザルト見出し（CLEAR! / TIME UP）、RANK とランク文字（リザルト・記録一覧・共有画像）、共有画像の LEVEL n CLEAR。favicon は `<head>` の data URI（SVG: 左下の地球へ「あ」の隕石が落ちてくる）
8. **canvas ゲーム**: 隕石・破片・浮遊テキスト（撃破語の表記 / COMBO / ラスト10秒 / -1）の描画と `requestAnimationFrame` + `dt` 駆動の `update`/`draw`。空の色は `sky` がレベルの色へなじむ。着地時は `shake` で全体を揺らす
9. **SFX / BGM**: Web Audio合成。AudioContext は SFX に1つだけ生成し `SFX.context()` で BGM と共有。**初回のユーザー操作（スタートボタン/キータッチ）でしか起動できない**。BGM はチップチューン（`MELODY`/`CHORDS` を先読みスケジューラで予約。テンポはレベルとラストスパートで上がる）
10. **ゲーム状態・入力・UI配線**: `game`（`timeLeft`/`level`/`destroyed`/`required`/`combo`）、統計 `stats`、記録 `juni.records`、`showResult(rec, mode)`（clear / fail / view の3モード）、`finishGame(cleared)`、`startLevel(level)`、開始レベル選択、記録一覧、共有画像 `buildShareImage` / `shareResult`

## 重要な設計判断（変更時に壊しやすい不変条件）

- **`FLICK_MAP` が唯一の真実**。かな→行の対応（`KANA_ROW`）、語彙バリデーション、次キーヒントはすべてここから導出される。キー配置を変えるときは他を触らない
- **入力の展開モデル**: 各文字は実際の打鍵列に展開される（が=[か,゛]、ぱ=[は,゛,゛]、っ=[つ,゛]）。展開は `CYCLES` の位置から決まる。一方スコア用の `COST`（濁1/半濁2/小1）は仕様の規定値で、実打鍵数と一致しない文字（づ）があるが**仕様が優先**
- **ターゲティング**: 最初に一致した入力で隕石にロックされ、破壊・着地まで対象は変わらない。出題時は場の隕石と先頭入力トークンが重複しない語を選ぶ（表示文字でなくトークン基準）
- **出題規則**（`pickWord`）: 候補をフィルタして一様に選ぶ。第1候補は「語頭のひらがな（が≠か）が直近 `RECENT_FIRST_KANA` 語に出ていない ∧ 場内トークン重複なし ∧ 同じ語が直近 `RECENT_WORDS` 語に出ていない」。以降、同じ語→語頭の順に条件を緩め、場内重複回避だけは最後まで残す。語頭を避ける語数は `LEVEL_FIRST_LIMIT[i] = clamp(RECENT_FIRST_KANA, 1, プールの語頭種類数 − FIRST_KANA_SLACK)`（L1 は 13、L2 以降 20）。語彙を減らすときはこの前提（L2 以降で語頭 22 種以上）を壊さない
- **canvas/DOM の境界**: フィールドのみ canvas（座標はCSSピクセル、dprは `setTransform` で吸収）。キーパッド・HUD・オーバーレイ・フリックガイドは DOM。着地の判定線は canvas 下端そのもの（座標変換なし）
- **1プレイ = 1レベル（固定）**。終了条件は「`destroyed >= required` でクリア」か「`TIME_LIMIT` の時間切れ」の2つだけ。ライフもスコアもない
- **規定数** `requiredKills(level) = max(1, round(TIME_LIMIT / spawnIntervalFor(level) * CLEAR_RATIO))`。出現間隔を変えると規定数も変わる
- **着地は撃破数 −1**（0未満にならない）＋コンボリセット＋揺れ。ミス入力はコンボリセットのみ
- **場の補充**: 隕石が `METEOR_MIN` 未満なら出現間隔を待たずに補充する（`SPAWN_MIN_GAP` は空ける）。速く撃破するほど早くクリアできる根拠
- **開始レベル**: 解放上限 = `maxClearedLevel() + 1`（上限なし）。選択肢は最低 `START_LEVEL_SHOWN` 個、解放が超えたぶんだけ増え、枠(`--lv-rows` 段)内でスクロール。`startLevel(level)` は `settings.startLevel` も更新する
- **記録**: クリア時のみ更新。`juni.records[level]` はベストタイム更新（初クリア含む）のときだけ丸ごと置き換える。時間切れは記録に触れない。行別正答率の ↑↓ は同レベルの前ベストとの比較
- **リザルトの遷移**: クリア「次のレベルへ」と時間切れ「もう一度」は `startLevel()` で即開始（タイトルを経由しない）。「タイトルへ」と一時停止「やり直す」は `goToTitle()`。記録閲覧（view）の「閉じる」はオーバーレイを閉じるだけ（下にタイトルが残っている）
- **ドット文字は1か所のデータから**: ロゴも英字見出しもすべて `PIXEL_FONT` から描く。`PIXEL_FONT` にない文字は空白として描かれる（日本語は描けない。日本語の見出しは明朝体のまま）。ロゴの文字を変えるときは `LOGO.LINES` を、見出しの文言は `PIXEL_HEADINGS` を変える。HUD の幅は2段構成が前提（狭い端末は `--logo-hud-h-narrow` で縮める）
- **共有画像**: `buildShareImage(rec)` は 1080×1080 の canvas を返す純関数。`shareResult()` は Web Share API（`navigator.canShare({files})`）→ 失敗/非対応なら `#share` に `<img>` とダウンロードリンクを出す
- **localStorage キー**: `juni.records` / `juni.settings`（guide, hint, sfx, bgm, startLevel）。旧 `juni.best` / `juni.highscore` / `juni.history` と `settings.easy` / `settings.practice` は読まない

## 進め方（このリポジトリでの合意事項）

- 機能はフェーズ単位で実装し、**ブラウザで動作確認できる状態にしてから**ユーザーの実機確認を待つ
- 完了報告の前に必ず動作検証を行い、証拠（検証結果）を添える
