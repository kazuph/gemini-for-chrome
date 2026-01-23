# Gemini Side Panel Chrome Extension Development Plan

## 概要
Gemini 2.0 Flashを利用したChrome拡張機能。サイドパネルで動作し、閲覧中のページ内容（Markdown変換済み）を基に対話や、ページ上の操作（入力、クリック等）を行うことができる。

## 技術スタック
- **Language**: TypeScript
- **Framework**: React
- **Build Tool**: Vite
- **Extension Tooling**: @crxjs/vite-plugin (Manifest V3対応)
- **Styling**: Tailwind CSS (推奨) or CSS Modules
- **AI Model**: Gemini 2.0 Flash (via Google Generative AI SDK)
- **HTML Processing**: 
  - `@mozilla/readability` (メインコンテンツ抽出)
  - `turndown` (HTML to Markdown変換)

## アーキテクチャ

### 1. Components
- **Side Panel (React App)**:
  - **Chat Interface**: メッセージ表示、入力フォーム。
  - **Settings**: APIキーの設定と保存 (`chrome.storage.local`を使用)。
  - **Status Indicator**: 現在のコンテキスト（読み込み中、変換中など）を表示。

- **Content Scripts**:
  - `page-content.ts`: DOMにアクセスし、HTMLを取得、Markdownに変換してSide Panelへ送信。
  - `action-executor.ts`: AIからのツール呼び出し（Click, Fill, etc.）を実行。

- **Background Service Worker**:
  - 必要に応じてAPI通信のプロキシや、タブ間のメッセージング制御を行う（基本はSide Panelから直接APIを叩くか、CORS制約がある場合はBackground経由）。Gemini APIは通常ブラウザから直接叩けるはずだが、API Keyの保護観点ではローカル保存前提ならClient side実行で可。

### 2. Data Flow
1. User opens Side Panel.
2. Side Panel checks for API Key. If missing -> Show Settings.
3. User sends message ("Check this page").
4. Side Panel requests content from Content Script.
5. Content Script parses DOM -> Readability -> Turndown -> Returns Markdown.
6. Side Panel sends Prompt + Markdown to Gemini API.
7. Gemini responds (Text or Function Call).
8. If Function Call (e.g., `fill_form`):
   - Side Panel sends command to Content Script.
   - Content Script executes DOM manipulation.
   - Returns result to Side Panel.
   - Side Panel sends result to Gemini.

## 機能要件

### Phase 1: 基本機能 (Priority: High)
- [x] プロジェクトセットアップ
- [x] APIキー管理 (保存/読み込み)
- [x] チャットUIの実装
- [x] 現在のタブのHTML取得 & Markdown変換
  - `Readability`でノイズ除去
  - `Turndown`でMarkdown化

### Phase 2: ブラウザ操作 (Priority: Medium)
- [x] ツール定義 (Function Calling)
  - `click_element(selector: string)`
  - `fill_element(selector: string, value: string)`
  - `get_html(selector?: string)` (特定部分のみ取得)
- [x] Content Script側での実行ロジック実装

### Phase 3: その他
- [ ] 生HTML取得モード（設定で切り替え、またはトークン余裕がある場合）

## 検証計画
1. **Markdown変換精度**: ニュースサイトやブログで、広告が除去され本文がMarkdown化されているか確認。
2. **対話**: Geminiがコンテキストを理解して回答するか。
3. **操作**: 検索フォームへの入力とサブミットが動作するか。
