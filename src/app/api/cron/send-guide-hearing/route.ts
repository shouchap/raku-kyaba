import { NextResponse } from "next/server";
// 猛毒を避けるため、ここでDBやLINEのモジュールは一切importしません。

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // 1. 環境変数のチェック（ここで落ちるのを防ぐ）
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const cronSecret = process.env.CRON_SECRET;

    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase credentials");
      return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
    }

    // 2. セキュリティチェック（Cloud Schedulerからのアクセスか確認）
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn("Unauthorized access attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // 3. 必要なモジュールだけを、安全なこの場所で読み込む
    // ※もしここからのimportで落ちる場合は、どのモジュールが原因か特定できます
    console.log("Starting guide hearing process...");

    // （ここから下に、本来の案内数ヒアリングのロジックを書きますが、
    // まずは「DBから店舗一覧を取得するだけ」の安全な処理にします）
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, guide_hearing_time")
      // テストのため、とりあえず全部取得します
      .limit(5);

    if (error) {
      console.error("Supabase Error:", error);
      return NextResponse.json({ error: "Database error", details: error }, { status: 500 });
    }

    console.log("Successfully fetched stores:", stores);

    // 成功したら、取得した店舗データをそのまま返す（LINEはまだ送らない）
    return NextResponse.json({
      status: "ok",
      message: "Database connection successful",
      stores,
    });
  } catch (err: unknown) {
    // もし予期せぬエラーが起きても、絶対にここで捕まえてログに出す
    const message = err instanceof Error ? err.message : String(err);
    console.error("Critical Runtime Error:", message);
    return NextResponse.json(
      {
        error: "Runtime execution failed",
        message,
      },
      { status: 500 }
    );
  }
}

// POSTメソッドも用意しておく
export async function POST(request: Request) {
  return GET(request);
}
