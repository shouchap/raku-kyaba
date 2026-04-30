import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // キャッシュによるエラーを防止

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Hello World GET" });
}

export async function POST() {
  return NextResponse.json({ status: "ok", message: "Hello World POST" });
}
