// Gợi ý mỗi ngày: AI đề xuất việc MỚI để phát triển (kinh doanh, marketing, bản thân).
// - Cron (header x-cron-secret) mỗi sáng: tạo 3 gợi ý cho từng người đã bật, rồi gửi thông báo.
// - Người dùng đăng nhập gọi { action: 'more' }: tạo thêm 3 gợi ý cho chính mình (tối đa 9/ngày).
// Dữ liệu gửi cho AI: việc 14 ngày gần nhất, KPI, số liệu CRM dạng tổng hợp, gợi ý cũ và đánh giá.
import { addDays, admin, caller, cors, json, Member, notifyMember, vnNow } from '../_shared/common.ts';
import { callGemini, FALLBACKS, MODELS } from '../_shared/assistant.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const PER_RUN = 3;
const MAX_PER_DAY = 9;

const DEFAULT_PROFILE = `Fairplay Sports: công ty tổ chức sự kiện & giải đấu thể thao cho doanh nghiệp (B2B) — giải bóng đá, futsal, pickleball, chạy bộ, team building, hội thao nội bộ. Khách hàng: phòng Nhân sự / Công đoàn / Truyền thông nội bộ của doanh nghiệp vừa và lớn. Bán hàng qua tìm khách chủ động (LinkedIn, gọi, email, chuỗi 14 ngày 5 lần chạm), khách cũ quay lại theo mùa giải hằng năm, giới thiệu. Marketing: Facebook, LinkedIn, TikTok, website tin tức thể thao.`;

const AREA_LABEL: Record<string, string> = { sales: 'Kinh doanh', mkt: 'Marketing', growth: 'Phát triển bản thân', ops: 'Vận hành' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));

  if (body.action === 'more') {
    const me = await caller(req);
    if (!me) return json({ error: 'Phiên đăng nhập hết hạn, hãy đăng nhập lại' }, 401);
    if (!(me as Member & { ideas_on?: boolean }).ideas_on && me.role !== 'admin') return json({ error: 'Tài khoản chưa được bật Gợi ý mỗi ngày' }, 403);
    const today = vnNow().date;
    const { count } = await admin.from('cl_ideas').select('id', { count: 'exact', head: true }).eq('owner_id', me.id).eq('date', today);
    if ((count ?? 0) >= MAX_PER_DAY) return json({ error: `Hôm nay đã có ${count} gợi ý — mai quay lại nhé` }, 429);
    const r = await generate(me, today);
    return r.error ? json({ error: r.error }, 502) : json({ ideas: r.ideas });
  }

  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'Forbidden' }, 403);
  // Chẩn đoán: đo thời gian dựng dữ liệu cho 1 người (không gọi AI, không ghi gì)
  if (body.action === 'probe') {
    const t0 = Date.now();
    const { data: m } = await admin.from('cl_members').select('*').eq('active', true).eq('ideas_on', true).limit(1).maybeSingle();
    if (!m) return json({ error: 'no member' });
    const r = await generate(m as Member, vnNow().date, false, body.model);
    return json({ ms: Date.now() - t0, model: r.model, error: r.error, ideas: r.ideas });
  }
  const now = vnNow();
  if (now.dow === 0) return json({ ok: true, skipped: 'sunday' });
  const { data: members } = await admin.from('cl_members').select('*').eq('active', true).eq('ideas_on', true);
  const done: string[] = [];
  for (const m of (members ?? []) as Member[]) {
    const { count } = await admin.from('cl_ideas').select('id', { count: 'exact', head: true }).eq('owner_id', m.id).eq('date', now.date);
    if ((count ?? 0) > 0) continue;
    const r = await generate(m, now.date);
    if (r.ideas?.length) {
      await notifyMember(m, `💡 ${r.ideas.length} gợi ý mới hôm nay`, r.ideas.map((i) => `• ${i.title}`).join('\n'), { tag: 'ideas' });
      done.push(m.full_name);
    }
  }
  return json({ ok: true, done });
});

type Idea = { area: string; title: string; why: string; steps: string; effort: string };

async function generate(m: Member, today: string, save = true, force?: string): Promise<{ ideas?: Idea[]; error?: string; model?: string }> {
  const ctx = await buildContext(m, today);
  const { data: setting } = await admin.from('cl_settings').select('data').eq('id', 1).maybeSingle();
  // Gợi ý dùng model "lite" (~4 giây); model chat của trợ lý (~75 giây) chỉ làm dự phòng
  const model = force || (Deno.env.get('GEMINI_MODEL_IDEAS') ?? 'gemini-flash-lite-latest');
  const backup = MODELS[setting?.data?.ai_model ?? 'gemini-flash'] ?? MODELS['gemini-flash'];
  const profile = (setting?.data?.ideas_profile as string)?.trim() || DEFAULT_PROFILE;

  const system = `Bạn là cố vấn phát triển kinh doanh & marketing cho một thành viên của công ty dưới đây. Mỗi ngày bạn đề xuất ${PER_RUN} việc MỚI, cụ thể, làm được trong hôm nay, giúp họ tăng doanh số, làm marketing tốt hơn hoặc phát triển kỹ năng — những việc họ chưa nghĩ tới, không phải việc lặp lại họ vẫn làm.

${profile}

Quy tắc:
- Tiếng Việt, xưng "bạn". Tiêu đề là 1 hành động bắt đầu bằng động từ, tối đa 90 ký tự.
- "why": 1–2 câu, nêu lý do gắn với SỐ LIỆU THẬT trong dữ liệu (VD "12 lead đang ở Báo giá quá 14 ngày"). Không bịa số; thiếu dữ liệu thì dựa vào thời điểm trong năm / mùa vụ.
- "steps": 2–4 bước ngắn, mỗi bước 1 dòng, bắt đầu bằng "- ". Có thể kèm mẫu câu nhắn / tiêu đề bài / từ khoá tìm kiếm cụ thể.
- Đa dạng: trong ${PER_RUN} gợi ý nên có ít nhất 1 kinh doanh (sales) và 1 marketing (mkt) nếu hợp vai trò; gợi ý thứ 3 có thể là phát triển bản thân (growth: học 1 kỹ năng, đọc 1 tài liệu, áp dụng 1 công cụ AI) hoặc vận hành (ops).
- KHÔNG lặp lại việc đã có trong checklist, KHÔNG lặp lại gợi ý cũ. Ưu tiên kiểu gợi ý được đánh giá 👍, tránh kiểu bị 👎 / bỏ qua.
- Tận dụng mùa vụ: dịp lễ sắp tới, mùa doanh nghiệp lên kế hoạch ngân sách, mùa giải hằng năm của khách cũ.
- Thực tế với công ty nhỏ ở Việt Nam: không đề xuất việc tốn nhiều tiền hoặc cần cả team.`;

  const user = `Hôm nay: ${ctx.dateLine}\n\n${ctx.text}\n\nHãy đề xuất ${PER_RUN} gợi ý cho hôm nay.`;
  const out = await callGemini(force ? [model] : [...new Set([model, backup, ...FALLBACKS])], {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.9,
      // Không cần suy luận dài: tắt bớt "thinking" để trả lời nhanh (trước đó mất ~90 giây)
      thinkingConfig: { thinkingBudget: 512 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            area: { type: 'STRING', enum: ['sales', 'mkt', 'growth', 'ops'] },
            title: { type: 'STRING' },
            why: { type: 'STRING' },
            steps: { type: 'STRING' },
            effort: { type: 'STRING', enum: ['15 phút', '30 phút', '1 giờ', 'Nửa ngày'] },
          },
          required: ['area', 'title', 'why', 'steps', 'effort'],
        },
      },
    },
  }, 30_000);
  if (out.error) return { error: out.error === 'auth' ? 'Khoá Gemini không hợp lệ' : 'AI đang bận, thử lại sau ít phút' };
  let ideas: Idea[] = [];
  try {
    ideas = JSON.parse(out.data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '[]');
  } catch {
    return { error: 'AI trả về sai định dạng, thử lại' };
  }
  ideas = ideas.filter((i) => i?.title).slice(0, PER_RUN).map((i) => ({
    area: AREA_LABEL[i.area] ? i.area : 'growth',
    title: String(i.title).slice(0, 140),
    why: String(i.why ?? '').slice(0, 600),
    steps: String(i.steps ?? '').slice(0, 1500),
    effort: String(i.effort ?? '').slice(0, 20),
  }));
  if (!ideas.length) return { error: 'AI chưa đưa ra được gợi ý, thử lại' };
  if (!save) return { ideas, model: out.model };
  const { data: saved, error } = await admin.from('cl_ideas').insert(ideas.map((i) => ({ ...i, owner_id: m.id, date: today }))).select();
  if (error) return { error: error.message };
  return { ideas: saved as Idea[] };
}

// ---------------------------------------------------------------------------
// Dữ liệu đưa cho AI (chỉ số liệu tổng hợp + tên công ty; không gửi SĐT / email / tên người liên hệ)
// ---------------------------------------------------------------------------
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const STAGE: Record<string, string> = { new: 'Mới', contacted: 'Đã liên hệ', consulting: 'Đang tư vấn', quoted: 'Đã báo giá', negotiating: 'Thương lượng', won: 'Chốt', lost: 'Thất bại' };
const P_STATUS: Record<string, string> = { new: 'mới thêm', touching: 'đang chạm', replied: 'đã phản hồi', meeting: 'đã hẹn gặp', brief: 'đã có brief', recall: 'hẹn gọi lại', unfit: 'không phù hợp' };

// Dịp lễ / mùa vụ (dương lịch; Tết âm lịch ghi theo từng năm)
const OCCASIONS: [string, string][] = [
  ['01-01', 'Tết Dương lịch'], ['03-08', 'Quốc tế Phụ nữ 8/3'], ['04-30', 'Lễ 30/4 – 1/5'], ['06-01', 'Quốc tế Thiếu nhi'],
  ['09-02', 'Quốc khánh 2/9'], ['10-20', 'Phụ nữ Việt Nam 20/10'], ['11-20', 'Nhà giáo Việt Nam 20/11'], ['12-24', 'Giáng sinh'],
];
const LUNAR: Record<string, [string, string][]> = {
  '2026': [['2026-02-17', 'Tết Nguyên đán'], ['2026-09-25', 'Trung thu']],
  '2027': [['2027-02-06', 'Tết Nguyên đán'], ['2027-09-15', 'Trung thu']],
  '2028': [['2028-01-26', 'Tết Nguyên đán'], ['2028-10-03', 'Trung thu']],
};
function upcoming(today: string) {
  const y = Number(today.slice(0, 4));
  const list: [string, string][] = [];
  for (const yy of [y, y + 1]) {
    for (const [md, n] of OCCASIONS) list.push([`${yy}-${md}`, n]);
    list.push(...(LUNAR[String(yy)] ?? []));
  }
  const end = addDays(today, 60);
  return list.filter(([d]) => d >= today && d <= end).sort().map(([d, n]) => `${n} (${d.slice(8, 10)}/${d.slice(5, 7)})`);
}

async function buildContext(m: Member, today: string) {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  const month = Number(today.slice(5, 7));
  const quarter = Math.ceil(month / 3);
  const dateLine = `${WD[dow]}, ${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)} (quý ${quarter}). Dịp sắp tới trong 60 ngày: ${upcoming(today).join(', ') || 'không có'}.`;
  const isAdmin = m.role === 'admin';
  const deptName = m.dept === 'mkt' ? 'Marketing' : m.dept === 'sales' ? 'Kinh doanh' : 'Quản lý chung';
  const parts: string[] = [`NGƯỜI NHẬN: ${m.full_name} — ${isAdmin ? 'Quản lý (phụ trách cả kinh doanh và marketing)' : `${m.title || 'Nhân viên'} phòng ${deptName}`}.`];

  // 1) Checklist 14 ngày
  const { data: tasks } = await admin.from('cl_tasks').select('title, status, source, date')
    .eq('owner_id', m.id).eq('scope', 'work').eq('hidden', false).gte('date', addDays(today, -14)).lte('date', today);
  const byTitle = new Map<string, { n: number; done: number; source: string }>();
  for (const t of tasks ?? []) {
    const k = t.title.trim();
    const v = byTitle.get(k) ?? { n: 0, done: 0, source: t.source };
    v.n++;
    if (t.status === 'done') v.done++;
    byTitle.set(k, v);
  }
  const fixed = [...byTitle].filter(([, v]) => v.source === 'routine' || v.source === 'meeting').map(([k]) => k);
  const adhoc = [...byTitle].filter(([, v]) => v.source !== 'routine' && v.source !== 'meeting').slice(0, 40).map(([k, v]) => `${k}${v.done ? '' : ' (chưa xong)'}`);
  parts.push(`VIỆC CỐ ĐỊNH ĐANG LÀM (đừng gợi ý lại): ${fixed.join('; ') || 'không có'}`);
  parts.push(`VIỆC TỰ THÊM 14 NGÀY QUA: ${adhoc.join('; ') || 'không có'}`);

  // 2) KPI
  const { data: kpis } = await admin.from('cl_kpis').select('title, target, period, unit').eq('owner_id', m.id).eq('active', true);
  if (kpis?.length) parts.push(`KPI: ${kpis.map((k) => `${k.title} — mục tiêu ${k.target}${k.unit ? ' ' + k.unit : ''}/${k.period === 'week' ? 'tuần' : k.period === 'month' ? 'tháng' : 'quý'}`).join('; ')}`);

  // 3) CRM (quản lý: toàn công ty; nhân viên kinh doanh: phần của mình; marketing: tổng quan nguồn lead)
  try {
    parts.push(await crmContext(m, today, isAdmin));
  } catch (e) {
    console.error('crm context', e);
  }

  // 4) Gợi ý cũ & đánh giá
  const { data: past } = await admin.from('cl_ideas').select('title, area, status, feedback').eq('owner_id', m.id)
    .gte('date', addDays(today, -30)).order('created_at', { ascending: false }).limit(40);
  if (past?.length) {
    const mark = (p: { status: string; feedback: number | null }) =>
      p.feedback === 1 ? '👍' : p.feedback === -1 ? '👎' : p.status === 'added' ? 'đã thêm vào việc' : p.status === 'dismissed' ? 'bỏ qua' : 'chưa phản hồi';
    parts.push(`GỢI Ý 30 NGÀY QUA (không lặp lại):\n${past.map((p) => `- [${AREA_LABEL[p.area] ?? p.area}] ${p.title} → ${mark(p)}`).join('\n')}`);
  }
  return { dateLine, text: parts.join('\n\n') };
}

async function crmContext(m: Member, today: string, isAdmin: boolean) {
  const mine = !isAdmin && m.dept === 'sales';
  const lines: string[] = [];
  let q = admin.from('leads').select('stage, source, need, next_followup, last_activity_at, lost_reason, created_at, company, updated_at');
  if (mine) q = q.eq('assignee_id', m.id);
  const { data: leads } = await q.gte('created_at', addDays(today, -365));
  if (leads?.length) {
    const open = leads.filter((l) => !['won', 'lost'].includes(l.stage));
    const byStage = Object.entries(STAGE).map(([k, v]) => `${v} ${leads.filter((l) => l.stage === k).length}`).join(', ');
    const overdue = open.filter((l) => l.next_followup && l.next_followup < today).length;
    const noNext = open.filter((l) => !l.next_followup).length;
    const stale = open.filter((l) => l.last_activity_at < addDays(today, -14)).length;
    const staleQuoted = open.filter((l) => ['quoted', 'negotiating'].includes(l.stage) && l.last_activity_at < addDays(today, -10));
    lines.push(`CRM${mine ? ' (lead của bạn)' : ''}, 12 tháng: ${leads.length} lead — ${byStage}. Đang mở ${open.length}: ${overdue} quá hạn follow-up, ${noNext} chưa hẹn follow-up, ${stale} không tương tác ≥14 ngày.`);
    if (staleQuoted.length) lines.push(`Đã báo giá/thương lượng nhưng im ≥10 ngày: ${staleQuoted.length} lead${isAdmin ? ` (${staleQuoted.slice(0, 6).map((l) => l.company).filter(Boolean).join(', ')})` : ''}.`);
    const new30 = leads.filter((l) => l.created_at >= addDays(today, -30)).length;
    const new60 = leads.filter((l) => l.created_at >= addDays(today, -60) && l.created_at < addDays(today, -30)).length;
    lines.push(`Lead mới 30 ngày qua: ${new30} (30 ngày trước đó: ${new60}).`);
    const src = new Map<string, { n: number; won: number }>();
    for (const l of leads) {
      const k = l.source || 'Không rõ';
      const v = src.get(k) ?? { n: 0, won: 0 };
      v.n++;
      if (l.stage === 'won') v.won++;
      src.set(k, v);
    }
    lines.push(`Theo nguồn (số lead / chốt): ${[...src].sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([k, v]) => `${k} ${v.n}/${v.won}`).join(', ')}.`);
    const lost = new Map<string, number>();
    for (const l of leads.filter((x) => x.stage === 'lost' && x.updated_at >= addDays(today, -120))) {
      const k = (l.lost_reason || '').trim().toLowerCase().slice(0, 60);
      if (k) lost.set(k, (lost.get(k) ?? 0) + 1);
    }
    if (lost.size) lines.push(`Lý do thất bại 4 tháng qua: ${[...lost].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} (${n})`).join('; ')}.`);
  }

  // Mùa giải: khách đã tổ chức giải cùng kỳ năm trước (30–120 ngày tới)
  if (isAdmin || m.dept === 'sales') {
    const from = addDays(today, 30 - 365), to = addDays(today, 120 - 365);
    let eq = admin.from('events').select('event_date, sport, customer_id, customers!inner(name, owner_id)').gte('event_date', from).lte('event_date', to);
    if (mine) eq = eq.eq('customers.owner_id', m.id);
    const { data: evs } = await eq;
    if (evs?.length) {
      const names = [...new Set(evs.map((e: any) => `${e.customers?.name}${e.sport ? ' – ' + e.sport : ''} (${String(e.event_date).slice(5, 7)}/${String(e.event_date).slice(0, 4)})`))];
      lines.push(`Khách cũ đến mùa giải (năm ngoái tổ chức trong 1–4 tháng tới): ${names.length}${isAdmin ? ': ' + names.slice(0, 8).join('; ') : ''}.`);
    }
    // Tìm khách mới
    let pq = admin.from('customers').select('p_status').not('p_status', 'is', null);
    if (mine) pq = pq.eq('owner_id', m.id);
    const { data: ps } = await pq;
    if (ps?.length) {
      const c = new Map<string, number>();
      for (const p of ps) c.set(p.p_status, (c.get(p.p_status) ?? 0) + 1);
      lines.push(`Tìm khách mới (doanh nghiệp tiềm năng): ${[...c].map(([k, n]) => `${P_STATUS[k] ?? k} ${n}`).join(', ')}.`);
    }
  }
  return lines.length ? lines.join('\n') : 'CRM: chưa có số liệu.';
}
