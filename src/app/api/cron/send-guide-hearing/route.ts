import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
// Vercelで爆発しにくい、標準のNodeランタイムに戻します
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    // 1. 環境変数の取得
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    // LINEの共通トークン（もしあれば）
    const defaultLineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Missing Supabase config" }, { status: 500 });
    }

    // 2. 現在の時間を取得（例: "09:00"）
    // 日本時間(JST)で計算する
    const now = new Date();
    const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentHour = jstTime.getUTCHours().toString().padStart(2, '0');
    const currentTimeStr = `${currentHour}:00`;
    
    console.log(`[CRON] 案内数ヒアリング開始 - 現在時刻(JST): ${currentTimeStr}`);

    // 3. DBから店舗を取得
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: stores, error } = await supabase
      .from('stores')
      .select('id, name, guide_hearing_time, line_channel_access_token');

    if (error || !stores) {
      return NextResponse.json({ error: "DB Error", details: error }, { status: 500 });
    }

    // 4. 今送るべき店舗だけを絞り込む
    // "21:00" / "21:00:00" のようなフォーマット差異を吸収するため前方一致で判定
    const targetStores = stores.filter(
      (store) => store.guide_hearing_time && store.guide_hearing_time.startsWith(currentHour + ":")
    );
    
    if (targetStores.length === 0) {
      console.log(`[CRON] ${currentTimeStr} に送信設定されている店舗はありませんでした。`);
      return NextResponse.json({ status: "skipped", message: "No target stores" });
    }

    console.log(`[CRON] 送信対象店舗: ${targetStores.length}件`);

    // 5. 爆発しない安全な方法でLINE APIを直接叩く
    // （Cursorの複雑なモジュールを使わず、標準のfetch関数を使います）
    let successCount = 0;
    
    for (const store of targetStores) {
      const accessToken = store.line_channel_access_token || defaultLineToken;
      
      if (!accessToken) {
        console.warn(`[CRON] ${store.name} のLINEトークンがありません。スキップします。`);
        continue;
      }

      // 送信するメッセージ（サイト運営さん向けの案内数ヒアリング）
      // ※フルネーム表示などの要件は、ここで調整できます。
      const messageText = `【案内数ヒアリング】\n${store.name} のサイト運営ご担当者様\n\n本日のご案内組数を教えてください。`;

      try {
        const lineResponse = await fetch('https://api.line.me/v2/bot/message/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            messages: [
              {
                type: "text",
                text: messageText
              }
            ]
          })
        });

        if (lineResponse.ok) {
          console.log(`[CRON] ${store.name} への送信成功`);
          successCount++;
        } else {
          const errorData = await lineResponse.text();
          console.error(`[CRON] ${store.name} への送信失敗:`, errorData);
        }
      } catch (lineError) {
        console.error(`[CRON] ${store.name} 送信中に例外発生:`, lineError);
      }
    }

    return NextResponse.json({ 
      status: "ok", 
      message: `Completed`, 
      targetCount: targetStores.length,
      successCount: successCount
    });

  } catch (err: any) {
    console.error("Critical Runtime Error:", err.message);
    return NextResponse.json({ error: "Runtime execution failed", message: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
