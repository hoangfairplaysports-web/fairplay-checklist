// Giải đấu (phía Checklist): danh sách giải đang triển khai + checklist Trước / Trong / Sau của từng giải.
// Phần tiền, nhà cung cấp, nghiệm thu nằm ở Fairplay CRM → "Triển khai giải".
import { html, Modal, Avatar, Bar, Seg, Empty, ConfirmButton } from './ui.js';
import { useState, useMemo, useEffect, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { actions, LIVE } from './store.js';
import { PHASES, dLabel, fold } from './ev-core.js';
import { parseWorkbook, mergeTasks, mergeSheetTicks, taskKey, stageDate } from './checklist-import.js';
import * as U from './util.js';

const STATUS_BTNS = [['todo', '⬜', 'Chưa'], ['doing', '🔄', 'Đang làm'], ['waiting', '⏳', 'Chờ KH'], ['blocked', '🚧', 'Vướng'], ['done', '✅', 'Xong']];
const EV_STATUS = { preparing: 'Đang chuẩn bị', running: 'Đang diễn ra', done: 'Đã xong', cancelled: 'Đã huỷ' };

// Người phụ trách của 1 việc (nhiều người: pic_ids; dữ liệu cũ chỉ có pic_id)
export const picIdsOf = (t) => (t.pic_ids && t.pic_ids.length ? t.pic_ids : t.pic_id ? [t.pic_id] : []);
const isMine = (t, meId) => picIdsOf(t).includes(meId);
const picsPatch = (ids, t = {}) => ({ pic_ids: ids, pic_id: ids[0] || null, pic_name: ids.length ? null : t.pic_name || null });

export function eventStats(state, ev, meId) {
  const t = state.ev_tasks.filter((x) => x.event_id === ev.id);
  const today = U.todayStr();
  const done = t.filter((x) => x.status === 'done').length;
  return {
    total: t.length, done, pct: t.length ? Math.round((done / t.length) * 100) : 0,
    overdue: t.filter((x) => x.status !== 'done' && x.due_date && x.due_date < today).length,
    blocked: t.filter((x) => x.status === 'blocked').length,
    mine: t.filter((x) => isMine(x, meId) && x.status !== 'done').length,
  };
}

export function EventsView({ ctx }) {
  const { state, me } = ctx;
  const [openId, setOpenId] = useState(() => (location.hash.match(/^#event-(.+)$/) || [])[1] || null);
  const [tab, setTab] = useState('active');
  const [creating, setCreating] = useState(false);
  const [editEv, setEditEv] = useState(null);
  const events = (state.events || []).filter((e) => (tab === 'active' ? !['done', 'cancelled'].includes(e.status) : ['done', 'cancelled'].includes(e.status)))
    .sort((a, b) => (a.event_date || '9').localeCompare(b.event_date || '9'));
  const open = (state.events || []).find((e) => e.id === openId);
  if (open) return html`<${EventDetail} ctx=${ctx} ev=${open} onBack=${() => setOpenId(null)} />`;
  return html`<div class="page">
    <div class="page-head">
      <div><h1>🏆 Giải đấu</h1><div class="muted">Checklist triển khai từng giải — tạo từ báo giá trong Fairplay CRM → Triển khai giải</div></div>
      <div class="row">
        <${Seg} value=${tab} onChange=${setTab} options=${[{ id: 'active', label: 'Đang triển khai' }, { id: 'done', label: 'Đã xong' }]} />
        ${me.role === 'admin' && html`<button class="btn primary" onClick=${() => setCreating(true)}>⬆ Nhập checklist từ file</button>`}
      </div>
    </div>
    ${editEv && html`<${EditEvent} ctx=${ctx} ev=${editEv} onClose=${() => setEditEv(null)} />`}
    ${creating && html`<${ImportChecklist} ctx=${ctx} onClose=${() => setCreating(false)} onDone=${(id) => { setCreating(false); id && setOpenId(id); }} />`}
    ${!events.length && html`<${Empty}>${tab === 'active' ? 'Chưa có giải nào đang triển khai. Khi chốt giải, quản lý nhập báo giá ở Fairplay CRM → Triển khai giải.' : 'Chưa có giải nào đã xong.'}</${Empty}>`}
    <div class="pgrid wide">${events.map((e) => {
      const s = eventStats(state, e, me.id);
      const d = e.event_date ? U.diffDays(U.todayStr(), e.event_date) : null;
      const pm = state.people.find((p) => p.id === e.pm_id);
      return html`<div class="pcard evcard" onClick=${() => setOpenId(e.id)}>
        <div class="row between"><b class="evname">${e.name}</b>
          ${d != null && html`<span class=${'badge ' + (d < 0 ? '' : d <= 7 ? 'bad' : d <= 14 ? 'warn' : 'info')}>${d < 0 ? 'Đã diễn ra' : d === 0 ? 'Hôm nay' : 'Còn ' + d + ' ngày'}</span>`}</div>
        <div class="muted small">${[e.client_name, e.venue, e.event_date && U.fmtDayLong(e.event_date)].filter(Boolean).join(' · ')}</div>
        <div><div class="row between small"><span>${s.done}/${s.total} việc xong</span><b>${s.pct}%</b></div><${Bar} pct=${s.pct} cls="brand" /></div>
        <div class="row small gap">
          ${s.overdue > 0 && html`<span class="badge bad">${s.overdue} quá hạn</span>`}
          ${s.blocked > 0 && html`<span class="badge bad">🚧 ${s.blocked} vướng</span>`}
          ${s.mine > 0 && html`<span class="badge info">${s.mine} việc của tôi</span>`}
          ${pm && html`<span class="muted push">PM: ${pm.full_name}</span>`}
          ${me.role === 'admin' && html`<button class=${'btn sm' + (pm ? '' : ' push')} title="Sửa tên, ngày, địa điểm" onClick=${(x) => { x.stopPropagation(); setEditEv(e); }}>✏️ Sửa</button>`}
        </div>
      </div>`;
    })}</div>
  </div>`;
}

// Nhập TRỌN file checklist Excel: mọi sheet việc (mỗi sheet một chặng nếu có nhiều), "Điểm cần chốt", và các bảng phụ.
// Tạo giải mới, hoặc cập nhật giải có sẵn (giữ trạng thái + ghi chú đã làm trên app).
function ImportChecklist({ ctx, ev, onClose, onDone }) {
  const { state } = ctx;
  const staff = state.people.filter((p) => p.role !== 'bod' && p.active !== false);
  const [wb, setWb] = useState(null);
  const [offSheets, setOffSheets] = useState({});
  const [target, setTarget] = useState(ev ? ev.id : 'new');
  const [info, setInfo] = useState({ name: '', client_name: '', event_date: '', venue: '' });
  const [stages, setStages] = useState([]);
  const [mode, setMode] = useState(ev ? 'merge' : 'merge');
  const [roles, setRoles] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setErr('');
    try {
      const XLSX = await loadXlsx();
      const book = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const data = book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: null }) }));
      const res = parseWorkbook(data, state.people, file.name);
      if (!res.taskSheets.length && !res.tables.length) return setErr('Không tìm thấy sheet checklist (cần các cột Hạng mục · Task · PIC · Deadline).');
      setWb(res);
      setOffSheets({});
      setStages(res.stages);
      setInfo({ ...res.info, source_file: file.name });
      if (!ev) {
        const same = (state.events || []).find((x) => res.info.name && fold(x.name) === fold(res.info.name));
        if (same) { setTarget(same.id); setMode('merge'); }
      }
    } catch (x) {
      setErr('Không đọc được file: ' + x.message);
    }
  }
  const on = (n) => !offSheets[n];
  const toggle = (n) => setOffSheets((o) => ({ ...o, [n]: !o[n] }));
  const taskSheets = wb ? wb.taskSheets.filter((s) => on(s.sheet)) : [];
  const tables = wb ? wb.tables.filter((t) => on(t.name)) : [];
  const preview = taskSheets.flatMap((s) => s.tasks);
  const roleNames = [...new Set(preview.filter((t) => !t.pic_id && t.pic_name).map((t) => t.pic_name))];
  const evTarget = target === 'new' ? null : (state.events || []).find((x) => x.id === target);
  const curN = evTarget ? state.ev_tasks.filter((t) => t.event_id === evTarget.id).length : 0;
  const doneN = preview.filter((t) => t.status === 'done').length;
  const whoName = (t) => (t.pic_id ? state.people.find((p) => p.id === t.pic_id)?.full_name : roles[t.pic_name] ? state.people.find((p) => p.id === roles[t.pic_name])?.full_name : t.pic_name || '-');
  async function doImport() {
    setErr('');
    if (target === 'new' && !info.name.trim()) return setErr('Nhập tên giải.');
    setBusy(true);
    try {
      const stg = stages.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), date: s.date || null, venue: s.venue || null }));
      const firstDate = stg.map((s) => s.date).filter(Boolean).sort()[0];
      let e2 = evTarget;
      if (!e2) {
        e2 = await actions.createEvent({ name: info.name.trim(), client_name: info.client_name || null, event_date: info.event_date || firstDate || null, venue: info.venue || null,
          stages: stg, source_file: info.source_file ? `${info.source_file} (checklist)` : null, notes: 'Tạo từ file checklist' });
      } else if (stg.length) {
        actions.saveEvent(e2.id, { stages: stg });
        e2 = { ...e2, stages: stg };
      }
      const tasks = preview.map((t) => {
        const who = !t.pic_id && t.pic_name && roles[t.pic_name];
        const base = stageDate(e2, t.stage);
        const off = t.offset_days ?? (t.due_date && base ? U.diffDays(base, t.due_date) : null);
        return {
          ...t,
          ...(who ? { pic_id: who, pic_ids: [who], pic_name: null } : { pic_ids: t.pic_id ? [t.pic_id] : [] }),
          offset_days: off,
          due_date: t.due_date || (off != null && base ? U.addDays(off, base) : null),
        };
      });
      let sum = { added: tasks.length, updated: 0, kept: 0 };
      if (evTarget && mode === 'merge') {
        const m = mergeTasks(state.ev_tasks.filter((t) => t.event_id === e2.id), tasks);
        sum = m;
        await actions.syncEvTasks(e2.id, m.rows, false);
      } else {
        const rows = tasks.map((t) => ({ ...t, src_key: taskKey(t), _new: true }));
        if (evTarget && mode === 'append') sum.kept = curN;
        await actions.syncEvTasks(e2.id, rows, !!evTarget && mode === 'replace');
      }
      const oldSheets = (state.ev_sheets || []).filter((x) => x.event_id === e2.id);
      await actions.saveEvSheets(e2.id, tables.map((t) => mergeSheetTicks(oldSheets.find((o) => o.name === t.name), t)));
      setResult({ eventId: e2.id, name: e2.name, ...sum,
        sheets: [...taskSheets.map((s) => ({ name: s.sheet, kind: s.decisions ? 'Điểm cần chốt → việc' : s.stage ? 'Việc · chặng ' + s.stage : 'Việc', file: s.tasks.length, got: s.tasks.length, skipped: s.skipped.length })),
          ...tables.map((t) => ({ name: t.name, kind: 'Bảng phụ', file: t.rows.length, got: t.rows.length, skipped: 0 }))],
        off: wb.taskSheets.filter((s) => !on(s.sheet)).map((s) => s.sheet).concat(wb.tables.filter((t) => !on(t.name)).map((t) => t.name)) });
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  }
  const setI = (k) => (e) => { const v = e.target.value; setInfo((x) => ({ ...x, [k]: v })); };
  const setS = (i, k) => (e) => { const v = e.target.value; setStages((a) => a.map((s, j) => (j === i ? { ...s, [k]: v } : s))); };

  if (result) return html`<${Modal} title="Đã nhập xong" onClose=${() => (onDone ? onDone(result.eventId) : onClose())} wide>
    <div class="form">
      <p><b>${result.name}</b>: ${result.added} việc mới${result.updated ? `, ${result.updated} việc cập nhật (giữ trạng thái, ghi chú)` : ''}${result.kept ? `, ${result.kept} việc cũ không có trong file vẫn giữ nguyên` : ''}.</p>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Sheet trong file</th><th>Nhập thành</th><th class="num">Trong file</th><th class="num">Đã nhập</th><th></th></tr></thead>
        <tbody>${result.sheets.map((s) => html`<tr><td>${s.name}</td><td class="small">${s.kind}</td><td class="num">${s.file}</td><td class="num">${s.got}</td>
          <td>${s.got === s.file && !s.skipped ? '✅' : html`<span class="bad-t small">⚠️ ${s.skipped} dòng không đọc được</span>`}</td></tr>`)}</tbody>
      </table></div>
      ${result.off.length > 0 && html`<p class="muted small">Không nhập (đã bỏ tick): ${result.off.join(', ')}</p>`}
      <div class="row end"><button class="btn primary" onClick=${() => (onDone ? onDone(result.eventId) : onClose())}>Mở giải</button></div>
    </div>
  </${Modal}>`;

  return html`<${Modal} title="Nhập checklist từ file Excel" onClose=${onClose} wide>
    <div class="form">
      <p class="muted">Chọn file checklist của giải. Hệ thống đọc <b>tất cả các sheet</b>: sheet danh sách việc (cột Hạng mục · Task · SL · PIC · SUP · Mốc · Deadline · Tình trạng · Ghi chú),
        sheet "Điểm cần chốt", và các bảng như Giải thưởng, Vật tư, Run sheet, Nhân sự, Contact (vào tab Hồ sơ giải). File có nhiều sheet việc thì mỗi sheet là một chặng, có ngày D riêng.</p>
      <input id="ck-file" type="file" accept=".xlsx,.xls" onChange=${onFile} />
      ${err && html`<div class="err">${err}</div>`}
      ${wb && html`
        <fieldset class="fs"><legend>Các sheet trong file</legend>
          ${wb.taskSheets.map((s) => html`<label class="check" key=${s.sheet}><input type="checkbox" checked=${on(s.sheet)} onChange=${() => toggle(s.sheet)} />
            <b>${s.sheet}</b> - ${s.tasks.length} việc${s.decisions ? ' (nhóm ⚠️ Điểm cần chốt)' : s.stage ? ` · chặng ${s.stage}` : wb.stages.length ? ' · việc chung' : ''}${s.skipped.length ? html` <span class="bad-t small">⚠️ ${s.skipped.length} dòng không đọc được</span>` : ''}</label>`)}
          ${wb.tables.map((t) => html`<label class="check" key=${t.name}><input type="checkbox" checked=${on(t.name)} onChange=${() => toggle(t.name)} />
            <b>${t.name}</b> - bảng ${t.rows.filter((r) => r.c).length} dòng, ${t.header.length} cột${t.check_cols.length ? ` · tick được: ${t.check_cols.map((i) => t.header[i]).join(', ')}` : ''}</label>`)}
        </fieldset>
        <label>Nhập vào<select value=${target} onChange=${(e) => setTarget(e.target.value)}>
          <option value="new">＋ Tạo giải mới từ file này</option>
          ${(state.events || []).filter((x) => x.status !== 'cancelled').map((x) => html`<option value=${x.id}>${x.name}${x.event_date ? ' · ' + U.fmtShort(x.event_date) : ''} (${state.ev_tasks.filter((t) => t.event_id === x.id).length} việc)</option>`)}
        </select></label>
        ${target === 'new' ? html`<div class="grid2">
            <label>Tên giải *<input value=${info.name} onInput=${setI('name')} /></label>
            <label>Ngày D${stages.length ? ' (chặng đầu)' : ''}<input type="date" value=${info.event_date} onInput=${setI('event_date')} /></label>
            <label>Khách hàng<input value=${info.client_name} onInput=${setI('client_name')} /></label>
            <label>Địa điểm<input value=${info.venue} onInput=${setI('venue')} /></label>
          </div>`
        : html`<div class="seg-col">
            <label class="check"><input type="radio" name="ckmode" checked=${mode === 'merge'} onChange=${() => setMode('merge')} /> <b>Cập nhật theo file</b> - giữ trạng thái và ghi chú đã làm trên app, sửa nội dung theo file, thêm việc mới (khuyên dùng khi bạn sửa lại Excel)</label>
            <label class="check"><input type="radio" name="ckmode" checked=${mode === 'replace'} onChange=${() => setMode('replace')} /> Thay toàn bộ ${curN} việc hiện tại bằng file</label>
            <label class="check"><input type="radio" name="ckmode" checked=${mode === 'append'} onChange=${() => setMode('append')} /> Thêm vào cuối, giữ việc hiện tại</label>
          </div>`}
        ${stages.length > 0 && html`<fieldset class="fs"><legend>Chặng của giải (mỗi chặng một ngày D)</legend>
          ${stages.map((s, i) => html`<div class="grid-stage" key=${i}>
            <label>Chặng<input value=${s.name} onInput=${setS(i, 'name')} /></label>
            <label>Ngày D<input type="date" value=${s.date || ''} onInput=${setS(i, 'date')} /></label>
            <label>Địa điểm<input value=${s.venue || ''} onInput=${setS(i, 'venue')} /></label></div>`)}
        </fieldset>`}
        <p><b>${preview.length} việc</b> · ${doneN} đã xong · ${preview.filter((t) => t.status === 'waiting').length} chờ KH · ${preview.filter((t) => t.status === 'doing').length} đang làm · ${tables.length} bảng phụ</p>
        ${roleNames.length > 0 && html`<fieldset class="fs"><legend>Giao người cho từng vai trò PIC trong file</legend>
          <p class="muted small">Chọn người phụ trách cho mỗi vai trò; để trống thì giữ nguyên chữ vai trò, giao sau bằng "Giao cả nhóm" hoặc nút PIC trên từng việc.</p>
          <div class="grid2">${roleNames.map((r) => html`<label key=${r}>${r} <span class="muted small">(${preview.filter((t) => t.pic_name === r).length} việc)</span>
            <select value=${roles[r] || ''} onChange=${(e) => setRoles({ ...roles, [r]: e.target.value })}><option value="">- Giữ là "${r}" -</option>${staff.map((p) => html`<option value=${p.id}>${p.full_name}</option>`)}</select></label>`)}</div>
        </fieldset>`}
        <div class="table-wrap" style="max-height:300px;overflow:auto"><table class="table compact">
          <thead><tr>${stages.length > 0 && html`<th>Chặng</th>`}<th>Giai đoạn</th><th>Hạng mục</th><th>Việc</th><th>SL</th><th>PIC</th><th>Hạn</th></tr></thead>
          <tbody>${preview.map((t) => html`<tr>${stages.length > 0 && html`<td class="small">${t.stage || 'Chung'}</td>`}<td class="small">${PHASES[t.phase]}</td><td class="small">${t.category}</td>
            <td>${t.title}${t.status === 'done' ? ' ✅' : t.status === 'waiting' ? ' ⏳' : t.status === 'doing' ? ' 🔄' : ''}</td><td class="small">${t.qty || ''}</td>
            <td class="small">${whoName(t)}</td><td class="small">${t.due_date ? U.fmtShort(t.due_date) : dLabel(t.offset_days) || '-'}${t.due_time ? ' ' + t.due_time : ''}</td></tr>`)}</tbody>
        </table></div>
        <div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${busy} onClick=${doImport}>${busy ? 'Đang nhập…' : (target === 'new' ? 'Tạo giải và nhập ' : 'Nhập ') + preview.length + ' việc' + (tables.length ? ` + ${tables.length} bảng` : '')}</button></div>`}
    </div>
  </${Modal}>`;
}

// Sửa tên, khách hàng, ngày, địa điểm, các chặng của giải. Đổi ngày (giải / chặng) thì dời hạn các việc chưa xong theo ngày mới.
function EditEvent({ ctx, ev, onClose }) {
  const [f, setF] = useState({ name: ev.name || '', client_name: ev.client_name || '', event_date: ev.event_date || '', venue: ev.venue || '' });
  const [stages, setStages] = useState((ev.stages || []).map((x) => ({ ...x, old: x.name })));
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };
  const setS = (i, k) => (e) => { const v = e.target.value; setStages((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };
  const [shift, setShift] = useState(true);
  const tasks = ctx.state.ev_tasks.filter((t) => t.event_id === ev.id && t.status !== 'done' && t.offset_days != null);
  const next = { ...ev, event_date: f.event_date || null, stages: stages.map((x) => ({ name: x.name, date: x.date || null })) };
  // Việc của chặng đã bị đổi tên vẫn tính theo chặng mới
  const stageOf = (t) => stages.find((x) => x.old === t.stage)?.name ?? t.stage;
  // Chỉ dời việc của chặng (hoặc việc chung) có ngày D thay đổi; hạn đã chỉnh tay trong file được giữ nguyên
  const moved = tasks.filter((t) => { const nd = stageDate(next, stageOf(t)); const od = stageDate(ev, t.stage); return nd && od && nd !== od; });
  function save(e) {
    e.preventDefault();
    if (!f.name.trim()) return;
    const stg = stages.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), date: x.date || null, venue: x.venue || null }));
    actions.saveEvent(ev.id, { name: f.name.trim(), client_name: f.client_name.trim() || null, event_date: f.event_date || null, venue: f.venue.trim() || null, stages: stg });
    for (const x of stages) if (x.old && x.name.trim() && x.old !== x.name.trim())
      for (const t of ctx.state.ev_tasks.filter((t) => t.event_id === ev.id && t.stage === x.old)) actions.updateEvTask(t.id, { stage: x.name.trim() });
    if (shift) for (const t of moved) actions.updateEvTask(t.id, { due_date: U.addDays(t.offset_days, stageDate(next, stageOf(t))) });
    ctx.notify(shift && moved.length ? `Đã lưu, dời hạn ${moved.length} việc theo ngày mới` : 'Đã lưu');
    onClose();
  }
  return html`<${Modal} title="Sửa thông tin giải" onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <label>Tên giải *<input value=${f.name} onInput=${set('name')} /></label>
      <label>Khách hàng<input value=${f.client_name} onInput=${set('client_name')} /></label>
      <div class="grid2">
        <label>Ngày diễn ra (ngày D${stages.length ? ' - việc chung' : ''})<input type="date" value=${f.event_date} onInput=${set('event_date')} /></label>
        <label>Địa điểm<input value=${f.venue} onInput=${set('venue')} /></label>
      </div>
      <fieldset class="fs"><legend>Chặng (giải tổ chức nhiều nơi / nhiều ngày)</legend>
        ${stages.map((x, i) => html`<div class="grid-stage" key=${i}>
          <label>Chặng<input value=${x.name} onInput=${setS(i, 'name')} /></label>
          <label>Ngày D<input type="date" value=${x.date || ''} onInput=${setS(i, 'date')} /></label>
          <label>Địa điểm<input value=${x.venue || ''} onInput=${setS(i, 'venue')} /></label></div>`)}
        <button type="button" class="link small" onClick=${() => setStages((a) => [...a, { name: '', date: '', venue: '' }])}>+ Thêm chặng</button>
      </fieldset>
      ${moved.length > 0 && html`<label class="row"><input type="checkbox" checked=${shift} onChange=${(e) => setShift(e.target.checked)} /> Dời hạn ${moved.length} việc chưa xong theo ngày mới</label>`}
      <div class="row end"><button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary">Lưu</button></div>
    </form>
  <//>`;
}

function EventDetail({ ctx, ev, onBack }) {
  const { state, me } = ctx;
  const isAdmin = me.role === 'admin';
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(null);
  const [importing, setImporting] = useState(false);
  const [assignCat, setAssignCat] = useState(null);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState('*');
  const [tab, setTab] = useState('tasks');
  const today = U.todayStr();
  const stages = ev.stages || [];
  const sheets = (state.ev_sheets || []).filter((x) => x.event_id === ev.id).sort((a, b) => a.sort - b.sort);
  const all = state.ev_tasks.filter((t) => t.event_id === ev.id && (stage === '*' || (stage === '' ? !t.stage : t.stage === stage))).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const list = all.filter((t) =>
    filter === 'mine' ? isMine(t, me.id) : filter === 'open' ? t.status !== 'done' : filter === 'late' ? t.status !== 'done' && t.due_date && t.due_date < today : true);
  const s = eventStats(state, ev, me.id);
  const staff = state.people.filter((p) => p.role !== 'bod' && p.active !== false);
  const d = ev.event_date ? U.diffDays(today, ev.event_date) : null;
  return html`<div class="page">
    <div class="page-head">
      <div>
        <button class="link" onClick=${onBack}>‹ Tất cả giải</button>
        <h1>${ev.name}</h1>
        <div class="muted">${[ev.client_name, !stages.length && ev.venue, !stages.length && ev.event_date && `${U.fmtDayLong(ev.event_date)}${d != null ? ` (${d >= 0 ? 'còn ' + d + ' ngày' : 'đã qua'})` : ''}`].filter(Boolean).join(' · ')}</div>
        ${stages.map((x) => { const dd = x.date ? U.diffDays(today, x.date) : null; return html`<div class="muted small">📍 <b>${x.name}</b>${x.date ? ' · ' + U.fmtDayLong(x.date) + (dd != null ? ` (${dd >= 0 ? 'còn ' + dd + ' ngày' : 'đã qua'})` : '') : ''}${x.venue ? ' · ' + x.venue : ''}</div>`; })}
      </div>
      <div class="row">
        ${isAdmin && html`<select value=${ev.status} onChange=${(e) => actions.saveEvent(ev.id, { status: e.target.value })}>${Object.entries(EV_STATUS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`}
        ${isAdmin && html`<button class="btn" onClick=${() => setEditing(true)}>✏️ Sửa thông tin giải</button>`}
        ${isAdmin && html`<button class="btn" onClick=${() => setImporting(true)}>⬆ Nhập checklist từ file</button>`}
      </div>
    </div>
    ${editing && html`<${EditEvent} ctx=${ctx} ev=${ev} onClose=${() => setEditing(false)} />`}
    <div class="stats">
      <div class="stat"><b>${s.pct}%</b><span>Hoàn thành (${s.done}/${s.total})</span></div>
      <div class=${'stat ' + (s.overdue ? 'bad' : '')}><b>${s.overdue}</b><span>Việc quá hạn</span></div>
      <div class=${'stat ' + (s.blocked ? 'bad' : '')}><b>${s.blocked}</b><span>Đang vướng</span></div>
      <div class="stat info"><b>${s.mine}</b><span>Việc của tôi chưa xong</span></div>
    </div>
    ${sheets.length > 0 && html`<div class="evtabs mb">
      <button class=${'evtab' + (tab === 'tasks' ? ' on' : '')} onClick=${() => setTab('tasks')}>✅ Checklist việc</button>
      ${sheets.map((x) => html`<button class=${'evtab' + (tab === x.id ? ' on' : '')} onClick=${() => setTab(x.id)}>📋 ${x.name}</button>`)}
    </div>`}
    ${tab !== 'tasks' && sheets.find((x) => x.id === tab) ? html`<${SheetView} ctx=${ctx} sheet=${sheets.find((x) => x.id === tab)} />` : html`
    <div class="row between mb wrap gap">
      <${Seg} value=${filter} onChange=${setFilter} options=${[{ id: 'all', label: 'Tất cả' }, { id: 'mine', label: 'Của tôi' }, { id: 'open', label: 'Chưa xong' }, { id: 'late', label: 'Quá hạn' }]} />
      ${stages.length > 0 && html`<${Seg} value=${stage} onChange=${setStage} options=${[{ id: '*', label: 'Mọi chặng' }, { id: '', label: 'Việc chung' }, ...stages.map((x) => ({ id: x.name, label: x.name }))]} />`}
    </div>
    ${Object.entries(PHASES).map(([ph, label]) => {
      const rows = list.filter((t) => t.phase === ph);
      const cats = [...new Set(rows.map((t) => t.category || 'Khác'))];
      const n = all.filter((t) => t.phase === ph);
      return html`<section class="section" key=${ph}>
        <div class="section-head"><h2>▶ ${label.toUpperCase()} <span class="count">${n.filter((t) => t.status === 'done').length}/${n.length}</span></h2>
          ${isAdmin && html`<button class="btn sm" onClick=${() => setAdding({ phase: ph })}>+ Thêm việc</button>`}</div>
        ${!rows.length ? html`<div class="tempty">Không có việc.</div>` : html`<div class="ledger evledger has-inote">
          <div class="lg-head"><span>Hạn</span><span>Việc</span><span>Trạng thái</span><span>Ghi chú (như file khách)</span><span>🔒 Giao việc / lưu ý nội bộ</span><span></span></div>
          ${cats.map((c) => html`
            <div class="lg-div row between"><span>${c}</span>
              ${isAdmin && html`<button class="link small" onClick=${() => setAssignCat({ phase: ph, category: c, stage: stage === '*' ? undefined : stage || null })}>Giao cả nhóm</button>`}</div>
            ${rows.filter((t) => (t.category || 'Khác') === c).map((t) => html`<${EvRow} key=${t.id} t=${t} ctx=${ctx} staff=${staff} showStage=${stage === '*' && stages.length > 0} inoteCol />`)}`)}
        </div>`}
      </section>`;
    })}`}
    ${adding && html`<${EvTaskForm} ctx=${ctx} ev=${ev} init=${adding} staff=${staff} onClose=${() => setAdding(null)} />`}
    ${importing && html`<${ImportChecklist} ctx=${ctx} ev=${ev} onClose=${() => setImporting(false)} />`}
    ${assignCat && html`<${AssignGroup} ctx=${ctx} ev=${ev} group=${assignCat} staff=${staff} onClose=${() => setAssignCat(null)} />`}
  </div>`;
}

export function EvRow({ t, ctx, staff, showEvent, showStage, inoteCol }) {
  const { me, state } = ctx;
  const isAdmin = me.role === 'admin';
  const ids = picIdsOf(t);
  const canEdit = isAdmin || ids.includes(me.id);
  const [picking, setPicking] = useState(false);
  const today = U.todayStr();
  const [note, setNote] = useState(t.note || '');
  const [edit, setEdit] = useState(false);
  const [inote, setInote] = useState(t.internal_note || '');
  useEffect(() => setNote(t.note || ''), [t.note]);
  useEffect(() => setInote(t.internal_note || ''), [t.internal_note]);
  const late = t.status !== 'done' && t.due_date && t.due_date < today;
  const pic = ids.length ? ids.map((id) => state.people.find((p) => p.id === id)?.full_name || '?').join(', ') : t.pic_name;
  const ev = showEvent && state.events.find((e) => e.id === t.event_id);
  return html`<div class=${`crow st-${t.status}${late ? ' pr-high' : ''}`}>
    <div class="c-time">${t.due_date ? U.fmtShort(t.due_date) : '—'}${t.due_time && html`<small class="c-hour">${t.due_time}</small>`}<small>${dLabel(t.offset_days)}</small></div>
    <div class="c-title">
      <div class="c-name">${t.title}</div>
      <div class="c-meta">
        ${ev && html`<span class="m-assign">🏆 ${ev.name}${t.stage ? ' · ' + t.stage : ''}</span>`}
        ${showStage && html`<span class=${'stg' + (t.stage ? '' : ' stg-common')}>${t.stage || 'Chung'}</span>`}
        ${t.qty && html`<span class="m-qty">SL: ${t.qty}</span>`}
        ${isAdmin
          ? html`<span class="pic-wrap"><button type="button" class=${'pic-btn ' + (ids.includes(me.id) ? 'm-kpi' : '')} title="Bấm để giao / đổi người phụ trách" onClick=${() => setPicking(!picking)}>👤 ${pic || 'Chưa giao - bấm để giao'} ▾</button>
              ${picking && html`<${PicPicker} staff=${staff || state.people} value=${ids} onChange=${(next) => actions.updateEvTask(t.id, picsPatch(next, t))} onClose=${() => setPicking(false)} />`}</span>`
          : html`<span class=${ids.includes(me.id) ? 'm-kpi' : ''}>👤 ${pic || 'Chưa giao'}</span>`}
        ${t.sup_fp && html`<span>Hỗ trợ: ${t.sup_fp}</span>`}
        ${t.sup_client && html`<span>Phía KH: ${t.sup_client}</span>`}
        ${late && html`<span class="m-bad">Quá hạn ${U.diffDays(t.due_date, today)} ngày</span>`}
      </div>
      ${t.detail && html`<div class="c-detail">${t.detail}</div>`}
    </div>
    <div class="c-status" role="group" aria-label="Trạng thái">
      ${STATUS_BTNS.map(([k, ic, l]) => html`<button type="button" class=${'sb sb-' + k + (t.status === k ? ' on' : '')} disabled=${!canEdit} onClick=${() => k !== t.status && actions.updateEvTask(t.id, { status: k })} title=${l}><span>${ic}</span><em>${l}</em></button>`)}
    </div>
    <div class="c-note">
      ${canEdit
        ? html`<${GrowNote} value=${note} onInput=${setNote} onSave=${() => note !== (t.note || '') && actions.updateEvTask(t.id, { note })} />`
        : html`<div class=${'note-ro' + (note ? '' : ' empty-ro')}>${note || '—'}</div>`}
      ${!inoteCol && inote && html`<div class="inote-ro">🔒 ${inote}</div>`}
    </div>
    ${inoteCol && html`<div class="c-inote">
      ${isAdmin
        ? html`<${GrowNote} value=${inote} onInput=${setInote} placeholder="Giao cho ai, chú trọng gì, cần lưu ý gì…" cls="inote" onSave=${() => inote !== (t.internal_note || '') && actions.updateEvTask(t.id, { internal_note: inote })} />`
        : html`<div class=${'inote-ro' + (inote ? '' : ' empty-ro')}>${inote || '—'}</div>`}
    </div>`}
    <button type="button" class="c-more" disabled=${!isAdmin} onClick=${() => setEdit(true)} title="Sửa việc">⋯</button>
    ${edit && html`<${EvTaskForm} ctx=${ctx} task=${t} staff=${staff || state.people} onClose=${() => setEdit(false)} />`}
  </div>`;
}

// Ô ghi chú tự giãn theo nội dung: luôn thấy hết chữ. Enter = lưu, Shift+Enter = xuống dòng.
function GrowNote({ value, onInput, onSave, placeholder = 'Ghi chú / kết quả…', cls = '' }) {
  const ref = useRef(null);
  const fit = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } };
  useEffect(fit, [value]);
  useEffect(() => { addEventListener('resize', fit); return () => removeEventListener('resize', fit); }, []);
  return html`<textarea ref=${ref} rows="1" class=${'in-note grow ' + cls} value=${value} placeholder=${placeholder}
    onInput=${(e) => { onInput(e.target.value); fit(); }} onBlur=${onSave}
    onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }}></textarea>`;
}

function EvTaskForm({ ctx, ev, task, init = {}, staff, onClose }) {
  const evx = ev || ctx.state.events.find((e) => e.id === task.event_id);
  const [f, setF] = useState({ phase: 'before', category: '', title: '', detail: '', due_date: '', due_time: '', qty: '', stage: '', sup_fp: '', sup_client: '', ...init, ...(task || {}),
    pics: task ? picIdsOf(task) : [] });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cats = [...new Set(ctx.state.ev_tasks.filter((t) => t.event_id === evx.id).map((t) => t.category).filter(Boolean))];
  function save(e) {
    e.preventDefault();
    if (!f.title.trim()) return;
    const ext = f.pics.length ? '' : extName.trim();
    const patch = {
      phase: f.phase, category: f.category || 'Khác', title: f.title.trim(), detail: f.detail || null, due_date: f.due_date || null,
      offset_days: f.due_date && stageDate(evx, f.stage) ? U.diffDays(stageDate(evx, f.stage), f.due_date) : null,
      stage: f.stage || null, qty: f.qty || null, due_time: f.due_time || null,
      pic_ids: f.pics, pic_id: f.pics[0] || null, pic_name: ext || null, sup_fp: f.sup_fp || null, sup_client: f.sup_client || null,
    };
    if (task) actions.updateEvTask(task.id, patch);
    else actions.addEvTask({ ...patch, event_id: evx.id });
    ctx.notify('Đã lưu');
    onClose();
  }
  const [extName, setExtName] = useState(task?.pic_name || '');
  return html`<${Modal} title=${task ? 'Sửa việc' : 'Thêm việc cho giải'} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <label>Việc *<input id="evt-title" value=${f.title} onInput=${set('title')} /></label>
      <div class="grid2">
        <label>Giai đoạn<select id="evt-phase" value=${f.phase} onChange=${set('phase')}>${Object.entries(PHASES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label>Nhóm hạng mục<input id="evt-cat" list="evt-cats" value=${f.category} onInput=${set('category')} /><datalist id="evt-cats">${cats.map((c) => html`<option value=${c} />`)}</datalist></label>
      </div>
      <label>Chi tiết<textarea id="evt-detail" rows="2" value=${f.detail || ''} onInput=${set('detail')}></textarea></label>
      <div class="grid3">
        <label>Hạn chót<input id="evt-due" type="date" value=${f.due_date || ''} onInput=${set('due_date')} /></label>
        <label>Giờ / buổi<input id="evt-time" value=${f.due_time || ''} onInput=${set('due_time')} placeholder="VD: 16:00, chiều" /></label>
        <label>SL<input id="evt-qty" value=${f.qty || ''} onInput=${set('qty')} placeholder="VD: 10 sân" /></label>
      </div>
      ${(evx.stages || []).length > 0 && html`<label>Chặng<select value=${f.stage || ''} onChange=${set('stage')}><option value="">Việc chung</option>${evx.stages.map((x) => html`<option value=${x.name}>${x.name}</option>`)}</select></label>`}
      <div><b class="small">Người phụ trách (tick nhiều người được)</b>
        <div class="chips">${staff.map((p) => html`<button type="button" key=${p.id} class=${'chip ' + (f.pics.includes(p.id) ? 'on' : '')}
          onClick=${() => setF({ ...f, pics: f.pics.includes(p.id) ? f.pics.filter((x) => x !== p.id) : [...f.pics, p.id] })}>${f.pics.includes(p.id) ? '✓ ' : ''}${p.full_name}</button>`)}</div></div>
      ${!f.pics.length && html`<label>Hoặc người ngoài (đối tác / khách, ghi tên)<input id="evt-ext" value=${extName} onInput=${(e) => setExtName(e.target.value)} placeholder="VD: Anh Tân - 0903…" /></label>`}
      <div class="grid2">
        <label>Hỗ trợ (Fairplay)<input id="evt-supfp" value=${f.sup_fp || ''} onInput=${set('sup_fp')} /></label>
        <label>Phía khách hàng<input id="evt-supc" value=${f.sup_client || ''} onInput=${set('sup_client')} /></label>
      </div>
      <div class="row between">
        ${task ? html`<${ConfirmButton} label="🗑 Xoá việc" ask="Bấm lần nữa để xoá" onConfirm=${() => { actions.deleteEvTask(task.id); onClose(); }} />` : html`<span></span>`}
        <div class="row"><button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary">Lưu</button></div>
      </div>
    </form>
  </${Modal}>`;
}

// Bảng phụ của giải (Giải thưởng, Vật tư, Run sheet, Nhân sự, Contact…): hiện y như Excel.
// Cột "Đã …" là ô tick, ai cũng tick được; Admin sửa được các ô khác.
function SheetView({ ctx, sheet }) {
  const isAdmin = ctx.me.role === 'admin';
  const [q, setQ] = useState('');
  const checks = sheet.check_cols || [];
  const fq = fold(q);
  const rows = sheet.rows.map((r, i) => ({ r, i })).filter(({ r }) => !fq || (r.s ? true : fold(r.c.join(' ')).includes(fq)));
  const ticked = (v) => !!v && !/^(khong|no|chua|-|0)$/.test(fold(v));
  const stat = checks.map((j) => ({ name: sheet.header[j], n: sheet.rows.filter((r) => r.c && ticked(r.c[j])).length, of: sheet.rows.filter((r) => r.c).length }));
  return html`<section class="section">
    ${sheet.title && html`<h2 class="sh-title">${sheet.title}</h2>`}
    ${sheet.note && html`<div class="muted small pre mb">${sheet.note}</div>`}
    <div class="row between mb wrap gap">
      <input class="sh-search" placeholder="Tìm trong bảng…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="row gap small">${stat.map((x) => html`<span class="badge info">${x.name}: ${x.n}/${x.of}</span>`)}</div>
    </div>
    <div class="table-wrap sheet-wrap"><table class="table sheet">
      <thead><tr>${sheet.header.map((h, j) => html`<th class=${checks.includes(j) ? 'ck' : ''}>${h}</th>`)}</tr></thead>
      <tbody>${rows.map(({ r, i }) => (r.s
        ? html`<tr class="sh-sec" key=${i}><td colspan=${sheet.header.length}>${r.s}</td></tr>`
        : html`<tr key=${i}>${r.c.map((v, j) => checks.includes(j)
          ? html`<td class="ck"><label class="tick"><input type="checkbox" checked=${ticked(v)} onChange=${(e) => actions.setSheetCell(sheet.id, i, j, e.target.checked ? '✓' : '')} />${v && !/^(✓|x|v|ok|co|có|true)$/i.test(v) ? html`<span class="small">${v}</span>` : ''}</label></td>`
          : isAdmin ? html`<td><${SheetCell} value=${v} onSave=${(nv) => nv !== v && actions.setSheetCell(sheet.id, i, j, nv)} /></td>`
          : html`<td class="pre">${v}</td>`)}</tr>`))}</tbody>
    </table></div>
  </section>`;
}
function SheetCell({ value, onSave }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return html`<div class="sh-cell" contenteditable="true" spellcheck=${false}
    onBlur=${(e) => onSave(e.target.innerText.replace(/\n+$/, ''))}
    onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape') { e.target.innerText = v; e.target.blur(); } }}
    dangerouslySetInnerHTML=${{ __html: v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\n/g, '<br>') }}></div>`;
}

function AssignGroup({ ctx, ev, group, staff, onClose }) {
  const tasks = ctx.state.ev_tasks.filter((t) => t.event_id === ev.id && t.phase === group.phase && (t.category || 'Khác') === group.category && (group.stage === undefined || (group.stage ? t.stage === group.stage : !t.stage)));
  const [sel, setSel] = useState([]);
  const [mode, setMode] = useState('replace');
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  function apply() {
    for (const t of tasks) {
      const next = mode === 'add' ? [...new Set([...picIdsOf(t), ...sel])] : sel;
      actions.updateEvTask(t.id, picsPatch(next, t));
    }
    ctx.notify(`Đã giao ${tasks.length} việc cho ${sel.length} người`);
    onClose();
  }
  return html`<${Modal} title=${'Giao cả nhóm: ' + group.category} onClose=${onClose}>
    <div class="form">
      <p class="muted">${tasks.length} việc trong nhóm này sẽ giao cho những người được tick:</p>
      <div class="pick-list">${staff.map((p) => html`<label class="check" key=${p.id}><input type="checkbox" checked=${sel.includes(p.id)} onChange=${() => toggle(p.id)} /> ${p.full_name}</label>`)}</div>
      <${Seg} value=${mode} onChange=${setMode} options=${[{ id: 'replace', label: 'Thay người đang phụ trách' }, { id: 'add', label: 'Thêm vào người đang phụ trách' }]} />
      <div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button>
        <button class="btn primary" disabled=${!sel.length} onClick=${apply}>Giao cho ${sel.length || ''} người</button></div>
    </div>
  </${Modal}>`;
}

// Chọn nhanh nhiều người phụ trách ngay trên dòng việc (lưu mỗi lần tick)
function PicPicker({ staff, value, onChange, onClose }) {
  useEffect(() => {
    const close = (e) => !e.target.closest('.pic-wrap') && onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return html`<div class="pic-pop" role="dialog" aria-label="Chọn người phụ trách">
    <div class="small muted">Tick để giao, bỏ tick để gỡ:</div>
    ${staff.map((p) => html`<label class="check" key=${p.id}><input type="checkbox" checked=${value.includes(p.id)} onChange=${() => toggle(p.id)} /> ${p.full_name}</label>`)}
    <div class="row end"><button type="button" class="btn sm primary" onClick=${onClose}>Xong</button></div>
  </div>`;
}

let xlsxP;
export function loadXlsx() {
  xlsxP = xlsxP || import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm').then((m) => m.default || m);
  return xlsxP;
}

// Việc giải đấu của tôi cần làm trong 3 ngày tới (hiện trong "Hôm nay")
export function myEventTasks(state, meId) {
  const soon = U.addDays(3);
  return (state.ev_tasks || []).filter((t) => isMine(t, meId) && t.status !== 'done' && t.due_date && t.due_date <= soon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}
