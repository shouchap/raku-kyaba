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

    const { data: stores, error } = await supabase
      .from('stores')
      .select('id, name, guide_hearing_time, line_channel_access_token');

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

      const messagePayload = {
        type: "text",
        text: `【案内数ヒアリング】\n${store.name} のご担当者様\n\n本日のご案内組数を教えてください。`,
        quickReply: {
          items: [
            { type: "action", action: { type: "message", label: "0組", text: "案内数: 0組" } },
            { type: "action", action: { type: "message", label: "1組", text: "案内数: 1組" } },
            { type: "action", action: { type: "message", label: "2組", text: "案内数: 2組" } },
            { type: "action", action: { type: "message", label: "3組以上", text: "案内数: 3組以上" } }
          ]
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
