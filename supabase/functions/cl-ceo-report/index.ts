// Báo cáo của CEO AI (Claude Code, skill /fairplay-ceo) gửi về Telegram của quản lý.
// Gọi bằng POST { text } với header x-ceo-secret = CEO_REPORT_SECRET (khoá chỉ nằm trên máy Mac của quản lý).
// Chỉ gửi tới tài khoản admin đã liên kết Telegram; không đọc hay sửa dữ liệu nào khác.
import { admin, cors, json, telegram } from '../_shared/common.ts';

const SECRET = Deno.env.get('CEO_REPORT_SECRET');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SECRET || req.headers.get('x-ceo-secret') !== SECRET) return json({ error: 'Forbidden' }, 403);
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? '').trim();
  if (!text) return json({ error: 'Thiếu nội dung' }, 400);
  const { data: admins } = await admin.from('cl_members').select('id, telegram_chat_id').eq('role', 'admin').eq('active', true).not('telegram_chat_id', 'is', null);
  let sent = 0;
  for (const a of admins ?? []) if (await telegram(a.telegram_chat_id, text)) sent++;
  return json({ ok: sent > 0, sent });
});
