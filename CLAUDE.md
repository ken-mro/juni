# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「十二 JŪNI」— フリック入力で落下する「ことばの隕石」を破壊する、1分間タイムアタックのスマホ向けタイピングゲーム。成績はスコアではなく**到達レベル**。仕様の原典は [spec.md](spec.md)。実装は **index.html 一枚**で完結する。

## 絶対に守る制約

- **単一HTMLファイル**。CSS/JSすべてインライン。外部依存ゼロ（CDN・npm・ビルドツール・音源ファイル不可。音はWeb Audio APIで合成）
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
- 自動確認は Playwright MCP を使用。`page.mouse` の down/move/up でフリックを再現できる。ブラウザウィンドウが背面にあると rAF が約1fpsに間引かれ「隕石が動かない」ように見える点に注意（`update(dt)` を直接呼ぶ決定的テストが確実）
- 各変更後はコンソールエラーがないことまで確認してから完了報告する。確認用スクリーンショットをリポジトリに残さない

## アーキテクチャ（index.html 内の構成順）

1. **CSS**: `:root` トークン（縦配分 `--pad-h`、パレット。基調は「ビビッドな宇宙」= 深い紫 `--bg-deep` × 星の黄 `--ember: #ffd93d`、副アクセントに `--cyan` / `--pink`。明朝体はタイトル・LEVELバナーのみ）
2. **CONFIG / PALETTE / COST**: 全調整値。`FLICK_THRESHOLD`、`TIME_LIMIT`（60秒）、落下・出現・レベルカーブ、開始レベル解放、ランクしきい値、音量など。`PALETTE.SKY` はレベル別の空の色
3. **入力データ**: `KEY_LAYOUT`（3×4キー）、`FLICK_MAP`（キー行→[中央,左,上,右,下]、nullは無反応）、`CYCLES`（小゛゜の変換循環 か→が、は→ば→ぱ、つ→っ→づ）
4. **単語データ `WORDS`**: `"よみ|表記"` 形式のベタ書き（約210語、宇宙系2割）。起動時に `validateReading` で検査し不正語は `console.warn` してスキップ
5. **語彙モジュール**: `toBase` / `rowOf` / `extraCost` / `analyze`（`actions`=実フリック回数が難易度基準）
6. **レベル**: `LEVELS`（行の解放が難易度の主軸）と `LEVEL_POOLS`（起動時確定）。レベルはそのレベル内の撃破数 `game.levelKills` が `killsToNext(level)`（`LEVEL_KILLS` → `ENDLESS_KILLS_PER_LEVEL`）に達すると上がり続ける（速度は上限なし、出現間隔は下限あり）
7. **canvas ゲーム**: 隕石・破片・浮遊テキスト（撃破語の表記 / LEVEL UP / COMBO / ラスト10秒）の描画と `requestAnimationFrame` + `dt` 駆動の `update`/`draw`。空の色は `sky` がレベルの目標色へ毎フレームなじむ。着地時は `shake` で全体を揺らす
8. **SFX / BGM**: Web Audio合成。AudioContext は SFX に1つだけ生成し `SFX.context()` で BGM と共有。**初回のユーザー操作（スタートボタン/キータッチ）でしか起動できない**。BGM はチップチューン（`MELODY`/`CHORDS` を先読みスケジューラで予約。テンポはレベルとラストスパートで上がる）
9. **ゲーム状態・入力・UI配線**: `game` オブジェクト（`timeLeft`/`level`/`levelKills`/`combo`）、統計、記録 `juni.best`、オーバーレイ（スタート+開始レベル選択/一時停止/設定/TIME UP リザルト）

## 重要な設計判断（変更時に壊しやすい不変条件）

- **`FLICK_MAP` が唯一の真実**。かな→行の対応（`KANA_ROW`）、語彙バリデーション、次キーヒントはすべてここから導出される。キー配置を変えるときは他を触らない
- **入力の展開モデル**: 各文字は実際の打鍵列に展開される（が=[か,゛]、ぱ=[は,゛,゛]、っ=[つ,゛]）。展開は `CYCLES` の位置から決まる。一方スコア用の `COST`（濁1/半濁2/小1）は仕様の規定値で、実打鍵数と一致しない文字（づ）があるが**仕様が優先**
- **ターゲティング**: 最初に一致した入力で隕石にロックされ、破壊・着地まで対象は変わらない。出題時は場の隕石と先頭入力トークンが重複しない語を選ぶ（表示文字でなくトークン基準）。直近10語は再出題しない
- **canvas/DOM の境界**: フィールドのみ canvas（座標はCSSピクセル、dprは `setTransform` で吸収）。キーパッド・HUD・オーバーレイ・フリックガイドは DOM。着地の判定線は canvas 下端そのもの（座標変換なし）
- **ライフもスコアもない**。ミス入力も隕石の着地もコンボリセットのみ（着地は画面揺れ付き）。終了条件は `TIME_LIMIT` の時間切れだけ
- **場の補充**: 隕石が `METEOR_MIN` 未満なら出現間隔を待たずに補充する（`SPAWN_MIN_GAP` は空ける）。1分間の手持ち無沙汰を作らないための仕様
- **開始レベル**: タイトルで選択。解放上限は `juni.best.level − START_LEVEL_UNLOCK_OFFSET`（最低1、上限なし）。選択肢は最低 `START_LEVEL_SHOWN` 個、解放が超えたぶんだけ増え、枠(`--lv-rows` 段)内でスクロールする。`restart()` は `settings.startLevel` から始める
- **リセットの範囲**: `restart()`/`goToTitle()` はそのプレイ1回分の状態を全消去するが、自己ベスト・成長記録・設定は残す
- **localStorage キー**: `juni.best`（level, destroyed, maxCombo）/ `juni.settings`（guide, hint, sfx, bgm, startLevel）/ `juni.history`（直近20ゲームの level, destroyed, maxCombo と行別正答率。リザルトの前回比↑↓に使用）。旧 `juni.highscore` と `settings.easy` は読まない
- 画面遷移はタイトル経由に統一: TIME UP「もう一度」も一時停止「やり直す」もタイトル画面へ戻る

## 進め方（このリポジトリでの合意事項）

- 機能はフェーズ単位で実装し、**ブラウザで動作確認できる状態にしてから**ユーザーの実機確認を待つ
- 完了報告の前に必ず動作検証を行い、証拠（検証結果）を添える
