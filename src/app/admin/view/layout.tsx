/**
 * シフト一覧は attendance_schedules の最新状態を表示するため、静的キャッシュを無効化
 */
export const dynamic = "force-dynamic";

export default function AdminViewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
