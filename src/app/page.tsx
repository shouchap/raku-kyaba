/**
 * トップページ（APIのみのため簡易表示）
 */
export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>出勤確認システム API</h1>
      <p>LINE Webhook: POST /api/line/webhook</p>
    </main>
  );
}
