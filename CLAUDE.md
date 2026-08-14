# Prompt Builder — プロジェクト概要

個人用のAI画像・動画生成プロンプトビルダー。複数のAIモデル（Anima, Krea 2, GPT Image 2, Nano Banana 2, WAN, Google Veo, LTX-2.3, MiniMax）向けに、日本語/英語ハイブリッドのプロンプトを組み立てるWebアプリ。

## アーキテクチャ

- **フロントエンド**: バニラ HTML/CSS/JS（`index.html` / `app.js` / `data.js` / `style.css`）
  - Cloudflare Pages でホスティング: `prompt-builder-bun.pages.dev`
  - **このGitHubリポジトリ（`SHO38/prompt-builder`）に接続済み。`main`ブランチにpushすると自動デプロイされる**
- **バックエンド**: Cloudflare Worker（`worker-index.js`）
  - URL: `prompt-builder.corgi-orchestra-account.workers.dev`
  - Gemini API と Notion API へのプロキシ
  - **⚠️ 現状、このリポジトリの`worker-index.js`はGit連携されていない。編集後は手動でCloudflareダッシュボードのWorkerコードエディタに貼り付けて再デプロイする必要がある**（将来的にはWrangler + GitHub Actionsでの自動化が望ましい）
- **データストア**: Notion データベース（Templates / History / LoRA）

## Notion データベース

| DB | ID | 用途 |
|---|---|---|
| Templates | `3bbcce1207b1804fbd69c246b1e0802a` | クイックテンプレート |
| History | `3bbcce1207b1801da8d3c52c0ef3a0b1` | プロンプト生成履歴 |
| LoRA | `3bccce1207b1819fad7df0dde8be41a3` | LoRAトリガーワード一覧 |

### Templates DBスキーマ
- `名前`(title), `Category`(select: character/outfit/scene/style/quality), `Model`(select: anima…), `Sort`(number)
- `Pre`(text): 旧チップ式テンプレート用のJSON（例: `{"hair":["黒髪"],"eyes":["青い瞳"]}`）
- `Image`(text): 画像URL手入力用（レガシー）
- `PromptText`(text): **自由記述テンプレート用**（新方式、チップに縛られない文章）
- `ImageFile`(files): **アップロード画像用**（Notion File Upload API経由）

### History DBスキーマ
`名前`(title), `Prompt`(text), `Negative`(text), `Model`(select), `Language`(select: JA/EN), `Date`(date)

### LoRA DBスキーマ
`Name`(title), `Model`(select), `TriggerWords`(text), `Description`(text), `PreviewImage`(text)

## Worker環境変数
`GEMINI_KEY` / `NOTION_KEY` / `NOTION_TEMPLATES_DB` / `NOTION_HISTORY_DB` / `NOTION_LORA_DB`

## AIモデル（Gemini、ホワイトリスト制）
デフォルト: `gemini-3.5-flash-lite` / 高品質: `gemini-3.6-flash`

## 重要な設計・学び

- **Animaプロンプト形式**: Danbooruタグ＋自然言語ハイブリッド。タグは小文字・スペース区切り（`score_N`のみアンダーバー例外）。`@artist name`構文。重み付けは`(tag:1.2)`形式
- **Notion titleプロパティ名は`名前`**（英語の"Name"ではない）。コードでは`Object.keys(properties).find(k => properties[k].type === 'title')`で動的検出すること
- **テンプレートは2方式が共存**: 旧チップ式（`pre`フィールド、JSON）と新自由記述式（`promptText`フィールド、プレーンテキスト）。`applyTemplate()`は`promptText`が存在すればアイデア入力欄に追記、なければ従来通りチップに反映
- **画像アップロード**はNotion File Upload API（3ステップ: `/v1/file_uploads`作成→`/send`でバイナリ送信→ページ作成時に`file_upload`タイプで参照）。Notionホスト画像URLは署名付きで数十分〜1時間程度で失効する点に注意
- **セキュリティインシデント（対応済み）**: 過去に`setup_notion.py`（実トークンをハードコード）を誤ってCloudflare Pagesの手動アップロード履歴に含めてしまい、公開URLから閲覧可能な状態になっていた。Notionトークンは再発行済み、該当の古いPagesデプロイも削除済み。**今後、シークレットは絶対にコードへ直書きせず環境変数から読むこと**。ローカルの`setup_notion.py`もこの方針で修正済み

## デプロイフロー

1. ローカルでファイルを編集
2. `git add` → `git commit` → `git push origin main`（フロントエンドのみ）
3. Cloudflare Pagesが自動デプロイ
4. `worker-index.js`を変更した場合は、別途Cloudflareダッシュボードの Worker コードエディタへ手動で貼り付けて再デプロイ

## 既知の課題・今後の展開
- Worker（`worker-index.js`）のデプロイ自動化（Wrangler CLI + GitHub Actions）
- Anima以外のモデル（Krea 2, GPT Image 2, Nano Banana 2, WAN, Veo, LTX-2.3, MiniMax）の本格対応
- 複数人キャラ対応・性別に応じた日本語ポジションラベル
