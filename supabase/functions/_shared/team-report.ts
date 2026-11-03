// Báo cáo đội nhóm (AI Quản lý Đội nhóm): biến dữ liệu của hàm SQL cl_team_report()
// thành tin nhắn gửi quản lý. Cùng cách tính với Văn phòng AI.
import { admin } from './common.ts';

type Late = { d: string; t: string };
type Kpi = { t: string; type: string; target: number; period: string; from: string; v: number | null };
type Person = {
  name: string; on_leave_today: boolean; start_today: string | null; report_today: string | null;
  week_started: number; week_late: Late[]; week_very_late: number; week_no_start: string[];
  week_rep_due: number; week_rep_missing: string[]; week_rep_late: Late[];
  overdue: number; blocked: number; kpis: Kpi[];
};
type Team = { today: string; now: string; rules: { late_after: string; very_late: string; report_deadline: string }; people: Person[] };

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
function periodEnd(from: string, period: string) {
  const d = new Date(from + 'T00:00:00Z');
  if (period === 'week') d.setUTCDate(d.getUTCDate() + 6);
  else if (period === 'month') { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); }
  else { d.setUTCMonth(d.getUTCMonth() + 3); d.setUTCDate(0); }
  return d.toISOString().slice(0, 10);
}

// ok | warn | bad | wait (đầu kỳ, chưa đánh giá) | nodata (chưa nhập số)
function evalKpi(k: Kpi, p: Person, today: string) {
  let v = k.v == null ? null : Number(k.v);
  let auto = false;
  if (v == null && k.type === 'percent') {
    if (/đúng giờ/i.test(k.t) && p.week_started > 0) { v = Math.round(((p.week_started - p.week_late.length) / p.week_started) * 100); auto = true; }
    else if (/báo cáo.*đúng hạn/i.test(k.t) && p.week_rep_due > 0) {
      v = Math.round(((p.week_rep_due - p.week_rep_missing.length - p.week_rep_late.length) / p.week_rep_due) * 100);
      auto = true;
    }
  }
  const target = Number(k.target) || 1;
  const total = days(k.from, periodEnd(k.from, k.period)) + 1;
  const expected = (Math.min(total, days(k.from, today) + 1) / total) * 100;
  let st: string, show: string;
  if (k.type === 'bool') {
    show = v === 1 ? 'Xong' : 'Chưa xong';
    st = v === 1 ? 'ok' : expected >= 75 ? 'warn' : 'wait';
  } else if (k.type === 'percent') {
    if (v == null) return { st: 'nodata', show: 'Chưa nhập' };
    show = `${v}% / ${target}%`;
    st = v >= target ? 'ok' : v >= target - 10 ? 'warn' : 'bad';
  } else {
    const pct = ((v ?? 0) / target) * 100;
    show = `${v ?? 0} / ${target}`;
    st = pct >= expected - 25 ? 'ok' : pct >= expected - 50 ? 'warn' : 'bad';
    if (expected < 35 && pct < 100) st = 'wait';
  }
  return { st, show: show + (auto ? ' (tự tính 7 ngày)' : '') };
}

export function formatTeamReport(T: Team) {
  const R = T.rules, P = T.people;
  const dow = new Date(T.today + 'T00:00:00Z').getUTCDay();
  const lateNow = (p: Person) => {
    if (p.on_leave_today) return null;
    if (p.start_today) return toMin(p.start_today) > toMin(R.late_after) ? 'late' : 'ok';
    return dow !== 0 && toMin(T.now) > toMin(R.late_after) ? 'absent' : null;
  };
  const sec: { h: string; items: string[]; ok: string }[] = [];
  const afterDeadline = toMin(T.now) > toMin(R.report_deadline) && dow >= 1 && dow <= 5;
  const noRep = afterDeadline ? P.filter((p) => !p.on_leave_today && !p.report_today).map((p) => p.name) : [];
  const lateToday = P.filter((p) => lateNow(p) === 'late').map((p) => `${p.name} (${p.start_today})`);
  const absent = P.filter((p) => lateNow(p) === 'absent').map((p) => p.name);
  sec.push({ h: `Hôm nay ${dmy(T.today)}`, ok: 'Mọi người đến đúng giờ', items: [
    lateToday.length ? `Đến muộn (sau ${R.late_after}): ${lateToday.join(', ')}` : '',
    absent.length ? `Không bấm Bắt đầu ngày: ${absent.join(', ')}` : '',
    afterDeadline ? (noRep.length ? `Chưa nộp báo cáo ngày (hạn ${R.report_deadline}): ${noRep.join(', ')}` : 'Đã nộp đủ báo cáo ngày ✅') : '',
  ].filter(Boolean) });
  const att: string[] = [];
  for (const p of P) {
    if (p.week_late.length) att.push(`${p.name}: đi muộn ${p.week_late.length} lần (${p.week_late.map((x) => `${dmy(x.d)} ${x.t}`).join(', ')})${p.week_very_late ? `, ${p.week_very_late} lần sau ${R.very_late}` : ''}`);
    if (p.week_no_start.length) att.push(`${p.name}: không bấm Bắt đầu ngày ${p.week_no_start.length} ngày (${p.week_no_start.map(dmy).join(', ')})`);
  }
  sec.push({ h: '7 ngày qua · Chuyên cần', items: att, ok: 'Không ai đi muộn' });
  const rep: string[] = [];
  for (const p of P) {
    if (p.week_rep_missing.length) rep.push(`${p.name}: thiếu ${p.week_rep_missing.length}/${p.week_rep_due} báo cáo (${p.week_rep_missing.map(dmy).join(', ')})`);
    if (p.week_rep_late.length) rep.push(`${p.name}: nộp trễ ${p.week_rep_late.length} lần (${p.week_rep_late.map((x) => `${dmy(x.d)} ${x.t}`).join(', ')})`);
  }
  sec.push({ h: '7 ngày qua · Báo cáo ngày', items: rep, ok: 'Báo cáo đầy đủ, đúng hạn' });
  const kpi: string[] = [], nodata: string[] = [];
  for (const p of P) {
    const bad: string[] = [];
    let nd = 0;
    for (const k of p.kpis) {
      const e = evalKpi(k, p, T.today);
      if (e.st === 'bad' || e.st === 'warn') bad.push(`${k.t} ${e.show}${e.st === 'bad' ? ' (chậm)' : ' (hơi chậm)'}`);
      if (e.st === 'nodata') nd++;
    }
    if (bad.length) kpi.push(`${p.name}: ${bad.join('; ')}`);
    if (nd) nodata.push(`${p.name} (${nd})`);
  }
  if (nodata.length) kpi.push(`KPI chưa nhập số liệu: ${nodata.join(', ')}`);
  sec.push({ h: 'KPI kỳ này', items: kpi, ok: 'Mọi KPI đúng tiến độ' });
  const work = P.filter((p) => p.overdue || p.blocked).map((p) => `${p.name}: ${[p.overdue ? `${p.overdue} việc quá hạn` : '', p.blocked ? `${p.blocked} việc đang vướng` : ''].filter(Boolean).join(', ')}`);
  sec.push({ h: 'Công việc', items: work, ok: 'Không có việc quá hạn hay đang vướng' });
  return `📋 BÁO CÁO ĐỘI NHÓM · ${dmy(T.today)} ${T.now}\n` +
    sec.map((x) => `\n${x.h.toUpperCase()}\n` + (x.items.length ? x.items.map((i) => '• ' + i).join('\n') : '✓ ' + x.ok)).join('\n');
}

export async function teamReportText() {
  const { data, error } = await admin.rpc('cl_team_report');
  if (error) throw new Error(error.message);
  return formatTeamReport((typeof data === 'string' ? JSON.parse(data) : data) as Team);
}
