// Bộ nhắc việc — cron gọi mỗi 5 phút (header x-cron-secret = CRON_SECRET).
// Người dùng đã đăng nhập gọi với { action: 'test' } để nhận 1 thông báo thử.
import { admin, addDays, caller, cors, dowOf, fmtTime, json, Member, notifyMember, once, toMin, vnNow } from '../_shared/common.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const body = await req.json().catch(() => ({}));
  if (body.action === 'test') {
    const me = await caller(req);
    if (!me) return json({ error: 'Phiên đăng nhập hết hạn' }, 401);
    const r = await notifyMember({ ...me, notify_push: true }, '🔔 Fairplay Checklist', 'Thông báo đã hoạt động trên thiết bị này.', { tag: 'test' });
    return json(r);
  }
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'Forbidden' }, 403);

  const sent: string[] = [];
  try {
    await runReminders(sent);
  } catch (e) {
    return json({ error: String(e), sent }, 500);
  }
  return json({ ok: true, sent });
});

async function runReminders(sent: string[]) {
  const now = vnNow();
  const today = now.date;
  const sunday = now.dow === 0;
  const saturday = now.dow === 6;
  const [{ data: membersRaw }, { data: settingsRow }, { data: leaves }] = await Promise.all([
    admin.from('cl_members').select('*').eq('active', true),
    admin.from('cl_settings').select('data').eq('id', 1).maybeSingle(),
    admin.from('cl_leaves').select('*').lte('from', today).gte('to', today),
  ]);
  const members = (membersRaw ?? []) as Member[];
  const s = { late_after: '09:00', report_deadline: '17:00', ...(settingsRow?.data ?? {}) };
  const admins = members.filter((m) => m.role === 'admin');
  const staff = members.filter((m) => m.role === 'staff');
  const onLeave = (m: Member) => (leaves ?? []).some((l) => (l.person_id === m.id || l.type === 'holiday') && ['full', 'holiday'].includes(l.type));
  const working = (m: Member) => !sunday && !onLeave(m);
  const inWindow = (from: string, to: string) => now.minutes >= toMin(from) && now.minutes < toMin(to);
  const send = async (key: string, m: Member, title: string, text: string, tag?: string) => {
    if (await once(key)) {
      await notifyMember(m, title, text, { tag });
      sent.push(key);
    }
  };

  // Sinh việc routine hôm nay (phòng khi chưa ai mở app)
  if (now.minutes < 60) await admin.rpc('cl_generate_routines');

  // 1) Nhắc việc có giờ: trước 10–15 phút
  const { data: timed } = await admin.from('cl_tasks').select('id, owner_id, title, time, status, scope')
    .eq('date', today).neq('status', 'done').not('time', 'is', null);
  for (const t of timed ?? []) {
    const diff = toMin(t.time) - now.minutes;
    const m = members.find((x) => x.id === t.owner_id);
    if (!m || diff < 0 || diff > 15 || !working(m)) continue;
    await send(`rem:${t.id}:${today}`, m, `🕐 ${t.time} — ${t.title}`, `Còn ${diff} phút nữa.`, `rem-${t.id}`);
  }

  if (!sunday) {
    const { data: starts } = await admin.from('cl_daystarts').select('person_id, started_at').eq('date', today);
    const started = new Set((starts ?? []).map((x) => x.person_id));

    // 2) 8:50 — nhắc nhân viên bấm "Bắt đầu ngày làm việc"
    if (inWindow('08:50', '09:30'))
      for (const m of staff) if (working(m) && !started.has(m.id))
        await send(`start:${m.id}:${today}`, m, '☀️ Bắt đầu ngày làm việc', `Mở Fairplay Checklist và bấm "Bắt đầu ngày làm việc" trước ${s.late_after}.`, 'start');

    // 3) 9:15 — báo quản lý ai chưa bắt đầu
    if (inWindow('09:15', '10:00')) {
      const missing = staff.filter((m) => working(m) && !started.has(m.id));
      const late = (starts ?? []).filter((x) => staff.some((m) => m.id === x.person_id) && toMin(fmtTime(x.started_at)) > toMin(s.late_after));
      const lines = [
        missing.length ? `Chưa bắt đầu: ${missing.map((m) => m.full_name).join(', ')}` : 'Cả team đã bắt đầu ngày làm việc ✅',
        ...(late.length ? [`Bắt đầu trễ: ${late.map((x) => `${members.find((m) => m.id === x.person_id)?.full_name} (${fmtTime(x.started_at)})`).join(', ')}`] : []),
      ];
      for (const a of admins) await send(`sum915:${a.id}:${today}`, a, '👥 Team sáng nay', lines.join('\n'), 'sum915');
    }

    // 4) 9:00 — nhắc việc quá hạn
    if (inWindow('09:00', '10:30')) {
      const { data: overdue } = await admin.from('cl_tasks').select('owner_id, title').lt('due_date', today).neq('status', 'done');
      for (const m of members.filter((x) => x.role !== 'bod' && working(x))) {
        const mine = (overdue ?? []).filter((t) => t.owner_id === m.id);
        if (mine.length)
          await send(`od:${m.id}:${today}`, m, `⚠️ ${mine.length} việc quá hạn`, mine.slice(0, 5).map((t) => '• ' + t.title).join('\n'), 'overdue');
      }
    }

    // 5) 16:30 — nhắc chốt báo cáo (T2–T6)
    if (!saturday) {
      const { data: reps } = await admin.from('cl_reports').select('id, person_id, status, submitted_at, reviewed_at').eq('date', today);
      const submitted = new Set((reps ?? []).map((r) => r.person_id));
      if (inWindow('16:30', toHm(toMin(s.report_deadline))))
        for (const m of staff) if (working(m) && !submitted.has(m.id))
          await send(`rep:${m.id}:${today}`, m, '📝 Chốt báo cáo cuối ngày', `Hạn nộp ${s.report_deadline}. Phần việc đã làm được tự điền từ checklist.`, 'report');
      // 6) 17:30 — tổng kết cho quản lý
      if (inWindow('17:30', '19:00')) {
        const missing = staff.filter((m) => working(m) && !submitted.has(m.id));
        const pending = (reps ?? []).filter((r) => r.status === 'submitted').length;
        const text = [missing.length ? `Chưa nộp báo cáo: ${missing.map((m) => m.full_name).join(', ')}` : 'Đã nộp đủ báo cáo ✅', pending ? `${pending} báo cáo đang chờ duyệt.` : ''].filter(Boolean).join('\n');
        for (const a of admins) await send(`sum1730:${a.id}:${today}`, a, '📨 Báo cáo cuối ngày', text, 'sum1730');
      }
    }
  }

  // 7) Sự kiện trong 20 phút gần nhất
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  const [{ data: assigned }, { data: blocked }, { data: newReps }, { data: reviewed }] = await Promise.all([
    admin.from('cl_tasks').select('id, owner_id, title, due_date').eq('source', 'assigned').gte('created_at', since),
    admin.from('cl_tasks').select('id, owner_id, title, block_reason, need_help').eq('status', 'blocked').eq('scope', 'work').gte('updated_at', since),
    admin.from('cl_reports').select('id, person_id, submitted_at').eq('status', 'submitted').gte('submitted_at', since),
    admin.from('cl_reports').select('id, person_id, status, manager_note, reviewed_at').in('status', ['approved', 'returned']).gte('reviewed_at', since),
  ]);
  for (const t of assigned ?? []) {
    const m = members.find((x) => x.id === t.owner_id);
    if (m) await send(`asg:${t.id}`, m, '📌 Bạn được giao việc mới', t.title + (t.due_date ? ` (hạn ${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)})` : ''), 'assign');
  }
  for (const t of blocked ?? []) {
    const who = members.find((x) => x.id === t.owner_id);
    if (!who || who.role === 'admin') continue;
    for (const a of admins)
      await send(`blk:${t.id}:${a.id}:${t.block_reason ?? ''}`, a, `🚧 ${who.full_name} đang vướng`, `${t.title}\n${t.block_reason ?? ''}${t.need_help ? '\nCần: ' + t.need_help : ''}`, 'blocked');
  }
  for (const r of newReps ?? []) {
    const who = members.find((x) => x.id === r.person_id);
    for (const a of admins) await send(`newrep:${r.id}:${r.submitted_at}:${a.id}`, a, '📨 Báo cáo mới', `${who?.full_name ?? 'Nhân viên'} vừa nộp báo cáo ngày.`, 'newrep');
  }
  for (const r of reviewed ?? []) {
    const m = members.find((x) => x.id === r.person_id);
    if (m) await send(`rev:${r.id}:${r.reviewed_at}`, m, r.status === 'approved' ? '✅ Báo cáo đã được duyệt' : '↩ Báo cáo bị trả lại', r.manager_note || (r.status === 'returned' ? 'Mở app để xem và nộp lại.' : ''), 'review');
  }

  // 8) 8:30 — bản tin sáng cho quản lý (Telegram + app)
  if (inWindow('08:30', '09:00') && !sunday) {
    for (const a of admins) {
      const { data: mine } = await admin.from('cl_tasks').select('title, time, status, due_date, scope').eq('owner_id', a.id).neq('status', 'done').lte('date', today);
      const list = (mine ?? []).sort((x, y) => (x.time ?? '99').localeCompare(y.time ?? '99'));
      const yesterday = addDays(today, dowOf(today) === 1 ? -2 : -1);
      const { data: yRep } = await admin.from('cl_reports').select('person_id').eq('date', yesterday);
      const text = [
        `Hôm nay bạn có ${list.length} việc:`,
        ...list.slice(0, 12).map((t) => `• ${t.time ? t.time + ' ' : ''}${t.scope === 'private' ? '🔒 ' : ''}${t.title}${t.due_date && t.due_date < today ? ' ⚠️ quá hạn' : ''}`),
        '',
        `Báo cáo ngày ${yesterday.slice(8, 10)}/${yesterday.slice(5, 7)}: ${(yRep ?? []).length}/${staff.length} người đã nộp.`,
      ].join('\n');
      await send(`brief:${a.id}:${today}`, a, '☀️ Bản tin sáng', text, 'brief');
    }
  }
}

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
