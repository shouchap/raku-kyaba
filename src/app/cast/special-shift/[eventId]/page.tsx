import SpecialShiftForm from "./SpecialShiftForm";

export const dynamic = "force-dynamic";

export default async function CastSpecialShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ castId?: string }>;
}) {
  const { eventId } = await params;
  const sp = await searchParams;
  const castId = sp.castId?.trim() ?? "";

  if (!castId) {
    return (
      <div className="min-h-dvh bg-slate-50 px-4 py-12 text-center text-slate-700">
        <p>リンクが不正です。LINE の案内から開き直してください。</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 text-slate-900">
      <SpecialShiftForm eventId={eventId} castId={castId} />
    </div>
  );
}
