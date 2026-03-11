/**
 * LINE Webhook 署名検証
 *
 * 設計意図:
 * - LINE公式ドキュメントに従い、リクエストボディの完全一致を前提とする
 * - 署名検証前にJSONのパース・正規化を行わない（改行やスペースの違いで検証が失敗するため）
 * - 改ざん・第三者送信の防止が目的。IPアドレスはLINEが非公開のため署名検証が唯一の手段
 * - Web Crypto API を使用し、Vercel Edge Runtime で動作可能にする
 *
 * @see https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
 */
export async function verifyLineSignature(
  body: string,
  signature: string | null,
  channelSecret: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );
  const bytes = new Uint8Array(signatureBytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const computedBase64 = btoa(binary);

  // タイミング攻撃対策: 長さ不一致時は即時return、定数時間比較で漏洩を防ぐ
  if (computedBase64.length !== signature.length) {
    return false;
  }
  // 簡易定数時間比較（各文字をXORして0になるか）
  let result = 0;
  for (let i = 0; i < computedBase64.length; i++) {
    result |= computedBase64.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}
