// Dữ liệu mẫu cho chế độ DEMO — tên người là hư cấu.
import { uid, todayStr, addDays, eachDay, weekday, recursOn, routineAppliesTo, isWorkday, DEFAULT_SETTINGS, weekStart } from './util.js';

export const PEOPLE = [
  { id: 'u_admin', full_name: 'Quản lý', role: 'admin', dept: null, title: 'Trưởng phòng MKT & KD', notify: { push: true, telegram: true } },
  { id: 'u_mai', full_name: 'Nguyễn Mai Anh', role: 'staff', dept: 'mkt', title: 'Content / Social', notify: { push: true, telegram: false } },
  { id: 'u_kiet', full_name: 'Lê Tuấn Kiệt', role: 'staff', dept: 'mkt', title: 'Video / TikTok', notify: { push: false, telegram: true } },
  { id: 'u_bao', full_name: 'Trần Quốc Bảo', role: 'staff', dept: 'sales', title: 'Sales B2B', notify: { push: true, telegram: true } },
  { id: 'u_ha', full_name: 'Phạm Thu Hà', role: 'staff', dept: 'sales', title: 'Sales B2B', notify: { push: true, telegram: false } },
  { id: 'u_bod', full_name: 'Thành viên BOD', role: 'bod', dept: null, title: 'Ban giám đốc', notify: { push: true, telegram: false } },
];

const R = (o) => ({ id: uid(), active: true, priority: 'mid', scope: 'work', ...o });
const ROUTINES = [
  // Họp cố định cả team
  R({ title: 'Họp phòng ban', dept: 'all', repeat: 'weekdays', days: [1], time: '10:00', end_time: '11:30', kind: 'meeting', priority: 'high' }),
  R({ title: 'Họp phòng ban', dept: 'all', repeat: 'weekdays', days: [3], time: '16:30', end_time: '17:30', kind: 'meeting', priority: 'high' }),
  R({ title: 'Họp review tuần', dept: 'all', repeat: 'weekdays', days: [5], time: '15:00', end_time: '16:00', kind: 'meeting', priority: 'high' }),
  // Quản lý
  R({ title: 'Check email', owner_id: 'u_admin', repeat: 'daily', time: '09:00' }),
  R({ title: 'Check tin nhắn MXH (Facebook, Zalo, LinkedIn)', owner_id: 'u_admin', repeat: 'daily', time: '09:15' }),
  R({ title: 'Check CRM — lead mới & follow-up quá hạn', owner_id: 'u_admin', repeat: 'daily', time: '09:30', priority: 'high' }),
  R({ title: 'Duyệt báo cáo ngày của team', owner_id: 'u_admin', repeat: 'weekdays', days: [1, 2, 3, 4, 5], time: '17:15', priority: 'high' }),
  R({ title: 'Chốt KPI tháng & gửi BOD', owner_id: 'u_admin', repeat: 'monthly', month_day: 28, time: '16:00', priority: 'high' }),
  // Marketing
  R({ id: 'r_fb', title: 'Đăng bài Facebook', dept: 'mkt', repeat: 'daily', time: '09:30', kpi_key: 'fb' }),
  R({ id: 'r_li', title: 'Đăng bài LinkedIn', dept: 'mkt', repeat: 'weekdays', days: [1, 2, 3, 4, 5], time: '10:00', kpi_key: 'li' }),
  R({ id: 'r_tt', title: 'Đăng video TikTok', dept: 'mkt', repeat: 'daily', time: '14:00', kpi_key: 'tt' }),
  R({ title: 'Duyệt tin tức website', dept: 'mkt', repeat: 'daily', time: '11:00' }),
  R({ title: 'Lên content cho ngày mai', dept: 'mkt', repeat: 'weekdays', days: [1, 2, 3, 4, 5], time: '16:00' }),
  // Kinh doanh
  R({ title: 'Check CRM & lead mới', dept: 'sales', repeat: 'daily', time: '09:15', priority: 'high' }),
  R({ id: 'r_fu', title: 'Gọi / nhắn follow-up khách', dept: 'sales', repeat: 'daily', time: '10:00', kpi_key: 'fu', priority: 'high' }),
  R({ id: 'r_new', title: 'Tìm khách hàng mới (DN 300–1000 NV)', dept: 'sales', repeat: 'weekdays', days: [1, 2, 3, 4, 5], time: '14:00', kpi_key: 'new' }),
  R({ title: 'Cập nhật CRM cuối ngày', dept: 'sales', repeat: 'daily', time: '16:30' }),
];

const K = (o) => ({ id: uid(), type: 'count', period: 'week', active: true, manual: {}, ...o });
function makeKpis() {
  return [
    K({ key: 'fb', title: 'Bài đăng Facebook', owner_id: 'u_mai', target: 8, unit: 'bài' }),
    K({ key: 'li', title: 'Bài đăng LinkedIn', owner_id: 'u_mai', target: 5, unit: 'bài' }),
    K({ key: 'tt', title: 'Video TikTok', owner_id: 'u_kiet', target: 10, unit: 'video' }),
    K({ key: 'fb', title: 'Bài đăng Facebook', owner_id: 'u_kiet', target: 3, unit: 'bài' }),
    K({ key: 'fu', title: 'Follow-up khách hàng', owner_id: 'u_bao', target: 30, unit: 'khách' }),
    K({ key: 'new', title: 'Khách hàng mới tiếp cận', owner_id: 'u_bao', target: 25, unit: 'công ty' }),
    K({ key: 'fu', title: 'Follow-up khách hàng', owner_id: 'u_ha', target: 30, unit: 'khách' }),
    K({ key: 'new', title: 'Khách hàng mới tiếp cận', owner_id: 'u_ha', target: 20, unit: 'công ty' }),
    K({ key: 'quote', title: 'Báo giá đã gửi', owner_id: 'u_ha', target: 12, unit: 'báo giá', period: 'month' }),
    K({ key: 'lp', title: 'Landing page giải Pickleball Q4', owner_id: 'u_mai', type: 'bool', period: 'month', target: 1, unit: '' }),
  ];
}

// Hồ sơ "tính cách" để dữ liệu mẫu trông thật: giờ đến & tỉ lệ hoàn thành
const PROFILE = {
  u_admin: { start: [520, 545], done: 0.9 },
  u_mai: { start: [522, 541], done: 0.92, late: 0.1 },
  u_kiet: { start: [535, 570], done: 0.75, late: 0.55 },
  u_bao: { start: [526, 544], done: 0.85, late: 0.2 },
  u_ha: { start: [524, 542], done: 0.88, late: 0.15 },
};
let seedN = 7;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const iso = (date, mins) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60).toISOString();
};

export function instantiateRoutines(state, p, date) {
  if (!isWorkday(state, p.id, date)) return [];
  const out = [];
  for (const r of state.routines) {
    if (!routineAppliesTo(r, p) || !recursOn(r, date)) continue;
    if (state.tasks.some((t) => t.routine_id === r.id && t.owner_id === p.id && t.date === date)) continue;
    const kpi = r.kpi_key && state.kpis.find((k) => k.key === r.kpi_key && k.owner_id === p.id);
    out.push({
      id: uid(), owner_id: p.id, title: r.title, date, time: r.time || null, end_time: r.end_time || null,
      source: r.kind === 'meeting' ? 'meeting' : 'routine', routine_id: r.id, scope: r.scope || 'work', group: r.group || null,
      priority: r.priority || 'mid', status: 'todo', progress: 0, kpi_id: kpi ? kpi.id : null, created_at: iso(date, 480),
    });
  }
  return out;
}

const ADHOC = {
  mkt: ['Edit ảnh cho bài đăng giải chạy', 'Viết kịch bản vlog sự kiện', 'Thiết kế thư mời khách hàng', 'Dựng video recap giải Pickleball', 'Chuẩn bị ấn phẩm cho event cuối tuần'],
  sales: ['Gửi báo giá cho khách doanh nghiệp', 'Chuẩn bị proposal giải bóng đá nội bộ', 'Gặp khách tại văn phòng khách', 'Gọi lại khách hỏi giá sân', 'Tổng hợp danh sách DN khu công nghệ cao'],
  admin: ['Duyệt kế hoạch truyền thông tháng', 'Làm việc với đối tác sân', 'Review hợp đồng nhà tài trợ'],
};

export function makeSeed() {
  seedN = 7;
  const today = todayStr();
  const state = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    people: PEOPLE.map((p) => ({ ...p, active: true })),
    routines: ROUTINES.map((r) => ({ ...r })),
    kpis: makeKpis(),
    tasks: [],
    daystarts: [],
    reports: [],
    weekly: [],
    leaves: [
      { id: uid(), person_id: 'u_ha', from: addDays(-9), to: addDays(-8), type: 'full', note: 'Nghỉ phép việc gia đình' },
      { id: uid(), person_id: 'u_kiet', from: addDays(5), to: addDays(5), type: 'am', note: 'Khám sức khỏe' },
      { id: uid(), person_id: null, from: addDays(-40), to: addDays(-39), type: 'holiday', note: 'Nghỉ lễ Quốc khánh 2/9' },
    ],
    habits: [
      { id: 'h_run', owner_id: 'u_admin', title: 'Chạy bộ', icon: '🏃', days: [1, 3, 5], unit: 'km', target: 5 },
      { id: 'h_water', owner_id: 'u_admin', title: 'Uống đủ 2 lít nước', icon: '💧', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'h_sleep', owner_id: 'u_admin', title: 'Ngủ trước 23h', icon: '😴', days: [0, 1, 2, 3, 4, 5, 6] },
    ],
    habit_logs: [],
    chat: [],
  };
  const staffLike = state.people.filter((p) => p.role !== 'bod');
  const from = addDays(-75);
  for (const d of eachDay(from, today)) {
    const isToday = d === today;
    for (const p of staffLike) {
      if (!isWorkday(state, p.id, d)) continue;
      const pr = PROFILE[p.id];
      // Bắt đầu ngày làm việc
      if (!isToday || (p.id !== 'u_kiet' && p.id !== 'u_admin')) {
        let m = between(...pr.start);
        if (pr.late && rnd() < pr.late * 0.4) m += between(15, 50);
        if (isToday) m = Math.min(m, 541);
        state.daystarts.push({ id: uid(), person_id: p.id, date: d, started_at: iso(d, m) });
      }
      const inst = instantiateRoutines(state, p, d);
      for (const t of inst) {
        if (isToday) {
          if (t.time && t.time < '10:30' && p.id !== 'u_kiet' && p.id !== 'u_admin') {
            t.status = 'done';
            t.done_at = iso(d, Math.max(560, Number(t.time.slice(0, 2)) * 60 + 20));
            if (t.kpi_id) t.qty = between(1, 3);
            t.output = t.kpi_id ? `${t.qty} ${t.title.includes('video') ? 'video' : 'bài'}` : '';
          }
        } else if (rnd() < pr.done) {
          t.status = 'done';
          t.done_at = iso(d, between(560, 1050));
          if (t.kpi_id) t.qty = p.dept === 'sales' ? between(4, 8) : between(1, 3);
        }
        state.tasks.push(t);
      }
      // Việc phát sinh
      if (!isToday && rnd() < 0.5) {
        const pool = ADHOC[p.dept || 'admin'];
        const recent = d >= addDays(-3);
        const done = !recent || rnd() < 0.7; // việc cũ coi như đã xử lý xong (có thể trễ hạn)
        const due = addDays(between(0, 3), d);
        state.tasks.push({
          id: uid(), owner_id: p.id, title: pool[between(0, pool.length - 1)], date: d, due_date: due, source: 'adhoc',
          scope: 'work', priority: rnd() < 0.3 ? 'high' : 'mid', status: done ? 'done' : 'todo', progress: 0,
          done_at: done ? iso(rnd() < 0.8 ? d : addDays(between(0, 2), due) > today ? today : addDays(between(0, 2), due), between(600, 1040)) : null, created_at: iso(d, 600),
        });
      }
      // Báo cáo ngày
      if (p.role === 'staff' && !isToday && weekday(d) !== 6 && rnd() < 0.93) {
        const m = rnd() < 0.85 ? between(960, 1019) : between(1021, 1080);
        state.reports.push({
          id: uid(), person_id: p.id, date: d, submitted_at: iso(d, m), blockers: '', plan: '',
          status: d < addDays(-1) || rnd() < 0.5 ? 'approved' : 'submitted', reviewed_at: iso(d, 1060), manager_note: '',
        });
      }
    }
  }

  // Một vài việc "thật" cho hôm nay
  const T = (o) => state.tasks.push({ id: uid(), scope: 'work', priority: 'mid', status: 'todo', progress: 0, created_at: new Date().toISOString(), ...o });
  T({ owner_id: 'u_mai', title: 'Thiết kế landing page giải Pickleball Q4', date: addDays(-3), due_date: addDays(2), source: 'assigned', assigned_by: 'u_admin', priority: 'high', status: 'doing', progress: 60, note: 'Đã xong phần header + lịch thi đấu, còn form đăng ký', kpi_id: state.kpis.find((k) => k.key === 'lp').id });
  T({ owner_id: 'u_mai', title: 'Viết bài PR giải chạy Fairplay Run', date: addDays(-2), due_date: addDays(-1), source: 'adhoc', priority: 'high' });
  T({ owner_id: 'u_kiet', title: 'Dựng video recap giải bóng đá MSB', date: addDays(-1), due_date: today, source: 'assigned', assigned_by: 'u_admin', priority: 'high', status: 'blocked', block_reason: 'Chưa nhận được footage từ quay phim', need_help: 'Nhờ quản lý nhắc bên quay phim gửi file' });
  T({ owner_id: 'u_bao', title: 'Gửi báo giá giải Pickleball cho SVTech', date: today, due_date: today, source: 'adhoc', priority: 'high', status: 'doing', progress: 50 });
  T({ owner_id: 'u_ha', title: 'Chuẩn bị proposal giải bóng đá nội bộ Viettel', date: addDays(-1), due_date: addDays(3), source: 'plan', priority: 'mid' });
  T({ owner_id: 'u_admin', title: 'Gặp đối tác sân Pickleball Quận 7', date: today, time: '14:00', due_date: today, source: 'adhoc', priority: 'high' });
  T({ owner_id: 'u_admin', title: 'Duyệt kế hoạch truyền thông tháng 10', date: addDays(-2), due_date: addDays(1), source: 'adhoc', status: 'doing', progress: 40 });
  // Việc riêng của quản lý
  T({ owner_id: 'u_admin', title: 'Đóng tiền internet nhà', date: addDays(-1), due_date: addDays(2), source: 'adhoc', scope: 'private', group: 'family', priority: 'high' });
  T({ owner_id: 'u_admin', title: 'Thanh toán thẻ tín dụng', date: today, due_date: addDays(4), source: 'adhoc', scope: 'private', group: 'finance' });
  T({ owner_id: 'u_admin', title: 'Đặt lịch khám răng', date: today, source: 'adhoc', scope: 'private', group: 'health', priority: 'low' });

  // Nhật ký thói quen
  for (const d of eachDay(addDays(-80), addDays(-1))) {
    for (const h of state.habits) {
      if (!h.days.includes(weekday(d))) continue;
      if (rnd() < (h.id === 'h_run' ? 0.7 : 0.8)) state.habit_logs.push({ id: uid(), habit_id: h.id, date: d, value: h.unit ? between(3, 7) : 1 });
    }
  }

  // Báo cáo tuần trước
  const lastWeek = addDays(-7, weekStart());
  for (const p of state.people.filter((x) => x.role === 'staff')) {
    state.weekly.push({ id: uid(), person_id: p.id, week: lastWeek, highlights: 'Hoàn thành KPI chính của tuần', issues: '', next_plan: 'Duy trì tần suất, tập trung khách mới', submitted_at: iso(addDays(4, lastWeek), 860), status: 'approved' });
  }

  state.chat = [
    { role: 'bot', text: 'Chào bạn 👋 Mình là trợ lý Fairplay. Bạn có thể nhắn kiểu:\n• "Mai 3h chiều nhắc gọi chị Hoa MSB, quan trọng"\n• "Hôm nay còn gì?"\n• "Team hôm nay thế nào?"\n• "Sáng nay chạy 5km"', at: new Date().toISOString() },
  ];
  return state;
}
