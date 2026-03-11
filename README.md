# キャバクラ向け出勤確認システム（raku-kyaba）

LINE Messaging API を利用した出勤確認システム。マルチテナント（SaaS）対応。

## 技術スタック

- **言語**: TypeScript
- **バックエンド**: Hono + Next.js App Router (Vercel Edge)
- **データベース**: Supabase (PostgreSQL)
- **連携API**: LINE Messaging API

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数

`.env.example` を `.env.local` にコピーし、各値を設定してください。

```bash
cp .env.example .env.local
```

### 3. データベース

Supabase ダッシュボードの SQL Editor で `supabase/migrations/001_initial_schema.sql` を実行してください。

### 4. LINE Developers 設定

1. [LINE Developers Console](https://developers.line.biz/console/) でチャネルを作成
2. Webhook URL を `https://your-domain.com/api/line/webhook` に設定
3. 環境変数 `LINE_CHANNEL_SECRET` にチャネルシークレットを設定

## 開発

```bash
npm run dev
```

Webhook は `http://localhost:3000/api/line/webhook` で受信可能です。ngrok 等でトンネリングして LINE に登録してください。

## Flex Message の Postback data

出勤確認メッセージのボタンでは、以下の `data` 値を設定してください。

| 表示ラベル | data 値    |
| ---------- | ---------- |
| 出勤       | `attending` |
| 欠勤       | `absent`   |
| 遅刻       | `late`     |

## ディレクトリ構成

```
├── src/
│   ├── app/
│   │   ├── api/line/webhook/  # LINE Webhook エンドポイント
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/                   # ユーティリティ
│   └── types/                 # 型定義
├── supabase/
│   └── migrations/            # DDL
└── package.json
```
