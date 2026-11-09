// Đọc TRỌN file checklist Excel của một giải (nhiều sheet):
// - Sheet danh sách việc (có cột Task + Deadline) → việc, giữ đủ cột: hạng mục, chi tiết, SL, PIC, SUP, mốc D, hạn + giờ, tình trạng, ghi chú.
//   File có nhiều sheet việc (VD "Việc chung 2 chặng", "Checklist TP.HCM", "Checklist Hà Nội") → mỗi sheet là 1 chặng, có ngày D riêng.
// - Sheet "Điểm cần chốt" (Vấn đề + Hạn chốt) → việc nhóm "⚠️ Điểm cần chốt".
// - Các sheet còn lại (Giải thưởng, Vật tư, Run sheet, Nhân sự, Contact, Tổng quan…) → bảng phụ, giữ nguyên dòng / cột.
import { fold, matchMember } from './ev-core.js';

const txt = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const keepLines = (v) => (v == null ? '' : String(v).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim());
const DATE_RE = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/;
// "05/12/2026" → "2026-12-05"; "28/10" (không ghi năm) → năm của giải / năm nay
let YEAR = new Date().getFullYear();
export const ymd = (s, year = YEAR) => {
  const m = String(s || '').match(DATE_RE);
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return '';
  const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(year);
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const findCol = (row, test) => (row || []).findIndex((c) => test(fold(c)));
const cell = (r, i) => (i >= 0 ? txt(r[i]) : '');

// Ghi chú kiểu "Đã gửi", "Đã có" coi như việc đã xong
export const NOTE_DONE = /^(da gui|da co|da xong|da hoan thanh|da ky|da chot|hoan thanh)/;
export function statusOf(stTxt, noteTxt = '') {
  const s = fold(stTxt);
  if (/hoan thanh|^done|da ky|da xong|da chot|^xong/.test(s)) return 'done';
  if (/^cho\b|cho kh|cho khach|cho phan hoi|cho duyet|waiting/.test(s)) return 'waiting';
  if (/vuong|blocked|tac|tre han/.test(s)) return 'blocked';
  if (/^dang|progress/.test(s)) return 'doing';
  if (!s && NOTE_DONE.test(fold(noteTxt))) return 'done';
  return 'todo';
}
// Khoá đối chiếu khi nhập lại file: cùng chặng + hạng mục + tên việc = cùng một việc
export const taskKey = (t) => fold(`${t.stage || ''}|${t.category || ''}|${t.title || ''}`);

// "D-30" / "D+2" / "Ngày D" → số ngày lệch so với ngày D
function offsetOf(s) {
  const m = String(s || '').match(/D\s*([+-])\s*(\d+)/i);
  if (m) return (m[1] === '-' ? -1 : 1) * Number(m[2]);
  return /^ngay d\b|^d$|\(d\)/.test(fold(s)) ? 0 : null;
}
// Phần chữ còn lại sau ngày trong ô hạn: "04/12/2026 chiều" → "chiều", "Ngay" → "Ngay"
function timeOf(s) {
  const t = txt(s).replace(DATE_RE, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,·-]+|[\s,·-]+$/g, '');
  return t && !/^d\s*[+-]\s*\d+$/i.test(t) ? t : '';
}

function taskHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || [];
    if (findCol(r, (s) => s === 'task' || s.startsWith('cong viec') || s === 'viec') >= 0 &&
      findCol(r, (s) => s.startsWith('deadline') || s === 'han' || s.startsWith('han chot') || s.startsWith('han hoan thanh')) >= 0) return i;
  }
  return -1;
}
function decisionHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i] || [];
    if (findCol(r, (s) => s.startsWith('van de')) >= 0 && findCol(r, (s) => s.startsWith('han')) >= 0) return i;
  }
  return -1;
}

// Tên chặng từ tên sheet: "Checklist TP.HCM" → "TP.HCM"; "Việc chung 2 chặng" → null (việc chung)
function stageName(sheet) {
  const n = txt(sheet).replace(/^check\s*list\s*/i, '').trim();
  if (!n || /chung/.test(fold(n))) return null;
  return n;
}
// Ngày D + địa điểm của chặng từ các dòng trên tiêu đề cột: "D = 05/12/2026 | Văn Thánh Pickleball…"
function stageInfo(rows, h) {
  let date = '';
  let venue = '';
  for (const r of rows.slice(0, h)) {
    const cells = (r || []).flatMap((c) => txt(c).split(/\s*\|\s*/)).filter(Boolean);
    for (let i = 0; i < cells.length; i++) {
      const f = fold(cells[i]);
      if (/^d\s*=/.test(f)) {
        date = date || ymd(cells[i]);
        if (cells[i + 1] && !venue) venue = cells[i + 1];
      }
    }
    if (!date && cells.length === 1 && /checklist|chang/.test(fold(cells[0]))) date = ymd(cells[0]);
  }
  return { date, venue };
}

function parseTaskSheet(name, rows, h, members, stage) {
  const top = rows[h];
  const C = {
    stt: findCol(top, (s) => s === 'stt' || s === 'tt'),
    cat: findCol(top, (s) => s.startsWith('hang muc') || s.startsWith('nhom')),
    task: findCol(top, (s) => s === 'task' || s.startsWith('cong viec') || s === 'viec'),
    detail: findCol(top, (s) => s.startsWith('chi tiet') || s.startsWith('mo ta')),
    qty: findCol(top, (s) => s === 'sl' || s.startsWith('so luong') || s.startsWith('sl ')),
    pic: findCol(top, (s) => s.startsWith('pic') || s.startsWith('phu trach') || s.startsWith('nguoi phu trach')),
    supc: findCol(top, (s) => s.startsWith('sup') && s.includes('khach')),
    supf: findCol(top, (s) => s.startsWith('sup') && s.includes('fairplay')),
    moc: findCol(top, (s) => s.startsWith('moc')),
    due: findCol(top, (s) => s.startsWith('deadline') || s === 'han' || s.startsWith('han chot') || s.startsWith('han hoan thanh')),
    st: findCol(top, (s) => s.startsWith('tinh trang') || s.startsWith('trang thai')),
    note: top.reduce((a, c, i) => (fold(c).startsWith('ghi chu') && i !== findCol(top, (s) => s.startsWith('chi tiet')) ? [...a, i] : a), []),
  };
  let phase = 'before';
  let cat = '';
  const tasks = [];
  const skipped = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const filled = r.map(txt).filter(Boolean);
    if (!filled.length) continue;
    const f0 = fold(filled[0]);
    const title = cell(r, C.task);
    if (!title) {
      if (/truoc su kien|truoc giai|chuan bi/.test(f0) && filled.length === 1) { phase = 'before'; continue; }
      if (/trong su kien|trong giai|ngay thi dau|^▶ ngay d/.test(f0) && filled.length === 1 && /^▶/.test(filled[0])) { phase = 'during'; continue; }
      if (/sau su kien|sau giai|ket thuc/.test(f0) && filled.length === 1 && /^▶/.test(filled[0])) { phase = 'after'; continue; }
      if (/^▶/.test(filled[0])) {
        if (/trong/.test(f0)) phase = 'during';
        else if (/sau/.test(f0)) phase = 'after';
        else if (/truoc/.test(f0)) phase = 'before';
        continue;
      }
      if (filled.length === 1) { cat = filled[0].replace(/^[▶⚠️\s]+/u, ''); continue; }
      skipped.push(filled.join(' | '));
      continue;
    }
    const dueTxt = cell(r, C.due);
    const mocTxt = cell(r, C.moc);
    const offset = offsetOf(mocTxt) ?? offsetOf(dueTxt);
    const picTxt = cell(r, C.pic);
    const member = matchMember(picTxt, members);
    const stTxt = cell(r, C.st);
    const notes = C.note.map((j) => keepLines(r[j])).filter(Boolean);
    const status = statusOf(stTxt, notes.join(' '));
    // Tình trạng không quy được về trạng thái (VD "Option – chưa chốt") → giữ nguyên chữ trong ghi chú
    if (stTxt && status === 'todo' && !/^chua (lam|bat dau)$/.test(fold(stTxt))) notes.unshift(stTxt);
    const t = {
      phase,
      category: cell(r, C.cat) || cat || 'Khác',
      title,
      detail: keepLines(r[C.detail]) || null,
      qty: cell(r, C.qty) || null,
      stage,
      pic_id: member?.id ?? null,
      pic_name: member ? null : picTxt || null,
      sup_client: cell(r, C.supc) || null,
      sup_fp: cell(r, C.supf) || null,
      due_date: ymd(dueTxt) || null,
      due_time: timeOf(dueTxt) || null,
      offset_days: offset,
      status,
      note: notes.join('\n') || null,
    };
    tasks.push(t);
  }
  return { sheet: name.trim(), stage, tasks, skipped };
}

function parseDecisions(name, rows, h, members) {
  const top = rows[h];
  const C = {
    issue: findCol(top, (s) => s.startsWith('van de')),
    detail: findCol(top, (s) => s.startsWith('chi tiet') || s.startsWith('can cu')),
    impact: findCol(top, (s) => s.startsWith('anh huong')),
    plan: findCol(top, (s) => s.startsWith('de xuat') || s.startsWith('huong xu ly')),
    who: findCol(top, (s) => s.startsWith('nguoi chot') || s.startsWith('pic') || s.startsWith('phu trach')),
    due: findCol(top, (s) => s.startsWith('han')),
    st: findCol(top, (s) => s.startsWith('trang thai') || s.startsWith('tinh trang')),
    note: findCol(top, (s) => s.startsWith('ghi chu')),
  };
  const tasks = [];
  for (const r of rows.slice(h + 1)) {
    const title = cell(r, C.issue);
    if (!title) continue;
    const who = cell(r, C.who);
    const member = matchMember(who, members);
    const dueTxt = cell(r, C.due);
    const detail = [keepLines(r[C.detail]), C.impact >= 0 && cell(r, C.impact) && 'Ảnh hưởng: ' + keepLines(r[C.impact]), C.plan >= 0 && cell(r, C.plan) && 'Đề xuất xử lý: ' + keepLines(r[C.plan])].filter(Boolean).join('\n');
    const stTxt = cell(r, C.st);
    const status = statusOf(stTxt, cell(r, C.note));
    tasks.push({
      phase: 'before', category: '⚠️ Điểm cần chốt', title, detail: detail || null, qty: null, stage: null,
      pic_id: member?.id ?? null, pic_name: member ? null : who || null, sup_client: null, sup_fp: null,
      due_date: ymd(dueTxt) || null, due_time: timeOf(dueTxt) || null, offset_days: null, status,
      note: [stTxt && status === 'todo' ? stTxt : '', cell(r, C.note)].filter(Boolean).join('\n') || null,
    });
  }
  return { sheet: name.trim(), stage: null, tasks, skipped: [], decisions: true };
}

// Bảng phụ: giữ nguyên tiêu đề, dòng mô tả, tên cột, các dòng (dòng nhóm "▶ …" giữ làm dòng nhóm)
export function parseTable(name, rows) {
  const nonEmpty = (r) => (r || []).filter((c) => txt(c)).length;
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (nonEmpty(rows[i]) >= 3) { h = i; break; }
  if (h < 0) for (let i = 0; i < Math.min(rows.length, 15); i++) if (nonEmpty(rows[i]) >= 2) { h = i; break; }
  if (h < 0) return null;
  const pre = rows.slice(0, h).map((r) => (r || []).map(txt).filter(Boolean).join(' · ')).filter(Boolean);
  const body = rows.slice(h + 1).filter((r) => nonEmpty(r));
  let width = 0;
  for (const r of [rows[h], ...body]) (r || []).forEach((c, i) => { if (txt(c)) width = Math.max(width, i + 1); });
  const header = Array.from({ length: width }, (_, i) => keepLines(rows[h][i]) || '');
  const out = body.map((r) => {
    const cells = Array.from({ length: width }, (_, i) => keepLines(r[i]));
    const filled = cells.filter(Boolean);
    return filled.length === 1 && width > 2 && (cells[0] || /^▶/.test(filled[0])) ? { s: filled[0] } : { c: cells };
  });
  const check_cols = header.map((x, i) => (/^da\s/.test(fold(x)) ? i : -1)).filter((i) => i >= 0);
  return { name: name.trim(), title: pre[0] || null, note: pre.slice(1).join('\n') || null, header, rows: out, check_cols };
}

export function readEventInfo(sheets, fileName) {
  const info = { name: '', client_name: '', event_date: '', venue: '' };
  for (const { rows } of sheets) {
    for (const r of rows.slice(0, 40)) {
      const cells = (r || []).map((c) => (c == null ? '' : String(c).trim())).filter(Boolean);
      if (!cells.length) continue;
      const k = fold(cells[0]);
      if (!info.name && /checklist/.test(k) && cells.length === 1 && cells[0].length <= 120 && !/[.:]$/.test(cells[0]) && !/^(cot|ghi chu|luu y|sheet|huong dan)\b|\bsheet\b/.test(k))
        info.name = cells[0].replace(/\s*[-–]\s*checklist.*$/i, '').replace(/^checklist[^-–]*[-–]\s*/i, '').trim();
      if (cells.length < 2) {
        if (!info.event_date && /ngay d|ngay to chuc/.test(k)) info.event_date = ymd(cells[0]);
        continue;
      }
      if (!info.client_name && /^khach hang|^don vi to chuc|^chu dau tu/.test(k)) info.client_name = cells[1];
      if (!info.event_date && /^ngay to chuc|^ngay d\b|^thoi gian/.test(k)) info.event_date = ymd(cells[1]);
      if (!info.venue && /^dia diem|^san$|^san thi dau|^khu/.test(k)) info.venue = cells[1].split(/[,;]/)[0];
    }
  }
  if (!info.name) info.name = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\bchecklist\b/gi, '').trim();
  const nm = info.name.normalize('NFC').trim();
  if (nm === nm.toUpperCase()) info.name = nm.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
  return info;
}

// Đọc cả file. sheets = [{ name, rows }] (rows lấy bằng SheetJS, raw:false)
export function parseWorkbook(sheets, members = [], fileName = '') {
  // Năm mặc định cho ngày ghi thiếu năm ("28/10"): năm xuất hiện nhiều nhất trong file
  const years = {};
  for (const { rows } of sheets) for (const r of rows.slice(0, 60)) for (const c of r || []) for (const m of String(c ?? '').matchAll(/\d{1,2}\/\d{1,2}\/(20\d\d)/g)) years[m[1]] = (years[m[1]] || 0) + 1;
  YEAR = Number(Object.entries(years).sort((a, b) => b[1] - a[1])[0]?.[0]) || new Date().getFullYear();
  const taskSheets = [];
  const tables = [];
  const heads = sheets.map((s) => ({ ...s, h: taskHeader(s.rows), dh: decisionHeader(s.rows) }));
  const nTask = heads.filter((s) => s.h >= 0).length;
  const stages = [];
  for (const s of heads) {
    if (s.h >= 0) {
      const stage = nTask > 1 ? stageName(s.name) : null;
      if (stage) stages.push({ name: stage, ...stageInfo(s.rows, s.h) });
      const p = parseTaskSheet(s.name, s.rows, s.h, members, stage);
      if (p.tasks.length) taskSheets.push(p);
    } else if (s.dh >= 0) {
      const p = parseDecisions(s.name, s.rows, s.dh, members);
      if (p.tasks.length) taskSheets.push(p);
    } else {
      const t = parseTable(s.name, s.rows);
      if (t && t.rows.length) tables.push(t);
    }
  }
  const info = readEventInfo(sheets, fileName);
  const dated = stages.filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length) {
    info.event_date = dated[0].date;
    info.venue = stages.length > 1 ? stages.map((x) => x.name).join(' + ') : stages[0].venue || info.venue;
  }
  // Số dòng việc trong file (dòng có tên việc) để đối chiếu "không sót mục nào"
  return { info, stages, taskSheets, tables };
}

// Hạn của 1 việc theo ngày D của chặng (việc chung / không có chặng → ngày giải)
export function stageDate(ev, stage) {
  const st = stage && (ev.stages || []).find((x) => x.name === stage);
  return (st && st.date) || ev.event_date || null;
}

// Gộp việc từ file vào việc đang có của giải (nhập lại khi cập nhật Excel):
// giữ trạng thái + ghi chú đã cập nhật trên app, cập nhật nội dung, thêm việc mới. Việc không còn trong file thì giữ nguyên.
export function mergeTasks(existing, incoming) {
  const byKey = new Map();
  for (const t of existing) {
    const k = t.src_key || taskKey(t);
    if (!byKey.has(k)) byKey.set(k, t);
  }
  const used = new Set();
  const rows = [];
  let added = 0;
  let updated = 0;
  for (const t of incoming) {
    const k = taskKey(t);
    const old = byKey.get(k);
    if (old && !used.has(old.id)) {
      used.add(old.id);
      updated++;
      const hasPic = (old.pic_ids && old.pic_ids.length) || old.pic_id;
      rows.push({
        ...old, ...t, id: old.id, src_key: k,
        pic_id: hasPic ? old.pic_id : t.pic_id, pic_ids: hasPic ? old.pic_ids : t.pic_ids, pic_name: hasPic ? old.pic_name : t.pic_name,
        status: old.status !== 'todo' || t.status === 'todo' ? old.status : t.status,
        note: old.note || t.note,
      });
    } else {
      added++;
      rows.push({ ...t, src_key: k, _new: true });
    }
  }
  return { rows, added, updated, kept: existing.filter((t) => !used.has(t.id)).length };
}

// Nhập lại bảng phụ: giữ các ô đã tick trên app nếu dòng đó vẫn còn trong file
export function mergeSheetTicks(oldSheet, sheet) {
  if (!oldSheet) return sheet;
  const keyOf = (r, checks) => fold((r.c || []).filter((_, i) => !checks.includes(i)).slice(0, 4).join('|'));
  const old = new Map();
  for (const r of oldSheet.rows || []) if (r.c) old.set(keyOf(r, oldSheet.check_cols || []), r);
  const rows = sheet.rows.map((r) => {
    if (!r.c) return r;
    const o = old.get(keyOf(r, sheet.check_cols));
    if (!o) return r;
    const c = [...r.c];
    for (const i of sheet.check_cols) {
      const j = (oldSheet.header || []).indexOf(sheet.header[i]);
      if (!c[i] && j >= 0 && o.c[j]) c[i] = o.c[j];
    }
    return { c };
  });
  return { ...sheet, rows };
}
