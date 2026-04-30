import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    // 1. セキュリティチェック（ここで401を正しく処理）
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const defaultLineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Missing config" }, { status: 500 });
    }

    // 2. 時間チェック（日本時間）
    const now = new Date();
    const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentHour = jstTime.getUTCHours().toString().padStart(2, '0');

    // 3. DBから取得
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 💡 修正ポイント：guide_staff_names（スタッフ名リスト）もDBから取得する
    const { data: stores, error } = await supabase
      .from('stores')
      .select('id, name, guide_hearing_time, line_channel_access_token, guide_staff_names');

    if (error || !stores) {
      return NextResponse.json({ error: "DB Error" }, { status: 500 });
    }

    // 4. 今送るべき店舗を絞り込み
    const targetStores = stores.filter(store =>
      store.guide_hearing_time && store.guide_hearing_time.startsWith(currentHour + ":")
    );

    if (targetStores.length === 0) {
      return NextResponse.json({ status: "skipped" });
    }

    let successCount = 0;
    
    // 5. 選択肢付きでLINE送信
    for (const store of targetStores) {
      const accessToken = store.line_channel_access_token || defaultLineToken;
      if (!accessToken) continue;

      // 💡 修正ポイント：DBに登録されているスタッフ名の配列を取得
      const staffNames = Array.isArray(store.guide_staff_names) ? store.guide_staff_names : [];

      if (staffNames.length === 0) {
          console.warn(`[CRON] ${store.name} のスタッフ名が登録されていません`);
          continue;
      }

      // 💡 修正ポイント：スタッフ名からLINEの選択肢（クイックリプライ）を動的に作る
      // （※LINEの仕様上、ボタンは最大13個までなので .slice(0, 13) で安全対策をしています）
      const quickReplyItems = staffNames.slice(0, 13).map((name: string) => ({
        type: "action",
        action: {
          type: "message",
          label: name, // ボタンの見た目（例：和也）
          text: name   // 押した時に送信される文字（例：和也）
        }
      }));

      // 3枚目の画像と全く同じテキストとボタンの構成
      const messagePayload = {
        type: "text",
        text: `案内数の入力対象を選んでください (${store.name})。`,
        quickReply: {
          items: quickReplyItems
        }
      };

      try {
        const lineResponse = await fetch('https://api.line.me/v2/bot/message/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({ messages: [messagePayload] })
        });
        if (lineResponse.ok) successCount++;
      } catch (e) {
        console.error("LINE send error:", e);
      }
    }

    return NextResponse.json({ status: "ok", successCount });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
