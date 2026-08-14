# Prompt Builder セットアップ手順

## ファイル構成

```
prompt-builder/
├── index.html      ← メインページ
├── style.css       ← スタイル
├── app.js          ← アプリロジック
├── data.js         ← モデル設定データ
├── images/         ← テンプレート参照画像（後で追加）
│   └── .gitkeep
└── worker/
    └── index.js    ← Cloudflare Worker
```

---

## STEP 1: Notion データベースを作成

### テンプレート DB
Notion で新しいデータベースを作成し、以下のプロパティを追加：

| プロパティ名 | タイプ  | 用途 |
|------------|---------|------|
| Name       | タイトル | テンプレート名（例: 明るい少女） |
| Model      | セレクト | anima（固定で OK） |
| Category   | セレクト | character / outfit / scene / style / quality |
| Image      | テキスト | 画像パス（例: /images/anima_bright.jpg） |
| Pre        | テキスト | JSON形式の設定（下記参照） |
| Sort       | 数値    | 表示順 |

**Pre フィールドの書き方（JSON形式）:**
```json
{"expression":["笑顔"],"hair":["ロングヘア","黒髪"],"eyes":["青い瞳"]}
```

**Category の選択肢:**
- `character` → キャラクタータブ
- `outfit`    → 服装タブ
- `scene`     → シーンタブ
- `style`     → スタイルタブ
- `quality`   → クオリティタブ

### 履歴 DB
別のデータベースを作成し、以下のプロパティを追加：

| プロパティ名 | タイプ  |
|------------|---------|
| Name       | タイトル |
| Prompt     | テキスト |
| Negative   | テキスト |
| Model      | セレクト |
| Language   | セレクト |
| Date       | 日付    |

---

## STEP 2: Notion Integration を作成

1. https://www.notion.so/my-integrations にアクセス
2. 「新しいインテグレーション」を作成
3. **シークレット（トークン）** をコピーして保存
4. 作成した2つのDBをインテグレーションに共有（データベースを開き「接続先」から追加）
5. データベースのURLから **DB ID** をコピー
   - `https://notion.so/xxxxxxxxxxxxxxxx?v=...` の `xxx...` 部分

---

## STEP 3: Gemini API キーを取得

1. https://aistudio.google.com/apikey にアクセス
2. APIキーを作成してコピー

---

## STEP 4: Cloudflare Worker をデプロイ

1. https://dash.cloudflare.com にアクセス（無料アカウントで OK）
2. Workers & Pages → 「作成」→「Worker を作成」
3. `worker/index.js` の内容をエディタに貼り付けて「デプロイ」
4. Worker の設定 → 「変数」→ 以下の環境変数を追加：

| 変数名                 | 値 |
|----------------------|----|
| `GEMINI_KEY`         | Gemini API キー |
| `NOTION_KEY`         | Notion インテグレーションシークレット |
| `NOTION_TEMPLATES_DB`| テンプレート DB の ID |
| `NOTION_HISTORY_DB`  | 履歴 DB の ID |

5. Worker の URL を控える（例: `https://prompt-builder.yourname.workers.dev`）

---

## STEP 5: app.js の Worker URL を変更

`app.js` の1行目を編集：

```javascript
// 変更前
const WORKER_URL = 'https://your-worker.your-subdomain.workers.dev';

// 変更後（実際の URL に）
const WORKER_URL = 'https://prompt-builder.yourname.workers.dev';
```

---

## STEP 6: Cloudflare Pages にデプロイ

1. Cloudflare ダッシュボード → Workers & Pages → 「作成」
2. Pages → 「直接アップロード」
3. `prompt-builder` フォルダごとドラッグ＆ドロップ
4. デプロイ完了！発行された URL でアクセス可能に

**次回更新時:** 同じ手順でフォルダをドラッグするだけで上書き更新されます。

---

## テンプレート画像の追加方法

1. Anima などで参照画像を生成
2. `images/` フォルダに保存（例: `images/anima_bright.jpg`）
3. Notion テンプレート DB の Image フィールドに `/images/anima_bright.jpg` と入力
4. `prompt-builder` フォルダを再デプロイ（Cloudflare Pages にドラッグ）

画像をクリックすると拡大表示されます。

---

## トラブルシューティング

**テンプレートが表示されない**
→ Notion DB をインテグレーションに共有できているか確認
→ Worker の環境変数が正しく設定されているか確認

**AI 生成が動かない**
→ Worker の URL が正しいか確認（app.js 1行目）
→ Gemini API キーが有効か確認（Google AI Studio でテスト）

**Worker にアクセスできない**
→ Cloudflare Workers のダッシュボードでエラーログを確認
