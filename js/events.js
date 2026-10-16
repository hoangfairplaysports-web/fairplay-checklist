// Giải đấu (phía Checklist): danh sách giải đang triển khai + checklist Trước / Trong / Sau của từng giải.
// Phần tiền, nhà cung cấp, nghiệm thu nằm ở Fairplay CRM → "Triển khai giải".
import { html, Modal, Avatar, Bar, Seg, Empty, ConfirmButton } from './ui.js';
import { useState, useMemo, useEffect } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { actions, LIVE } from './store.js';
import { PHASES, dLabel, parseChecklistFile, fold } from './ev-core.js';
import * as U from './util.js';

const STATUS_BTNS = [['todo', '⬜', 'Chưa'], ['doing', '🔄', 'Đang làm'], ['blocked', '🚧', 'Vướng'], ['done', '✅', 'Xong']];
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
  const events = (state.events || []).filter((e) => (tab === 'active' ? !['done', 'cancelled'].includes(e.status) : ['done', 'cancelled'].includes(e.status)))
    .sort((a, b) => (a.event_date || '9').localeCompare(b.event_date || '9'));
  const open = (state.events || []).find((e) => e.id === openId);
  if (open) return html`<${EventDetail} ctx=${ctx} ev=${open} onBack=${() => setOpenId(null)} />`;
  return html`<div class="page">
    <div class="page-head">
      <div><h1>🏆 Giải đấu</h1><div class="muted">Checklist triển khai từng giải — tạo từ báo giá trong Fairplay CRM → Triển khai giải</div></div>
      <${Seg} value=${tab} onChange=${setTab} options=${[{ id: 'active', label: 'Đang triển khai' }, { id: 'done', label: 'Đã xong' }]} />
    </div>
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
        </div>
      </div>`;
    })}</div>
  </div>`;
}

function EventDetail({ ctx, ev, onBack }) {
  const { state, me } = ctx;
  const isAdmin = me.role === 'admin';
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(null);
  const [importing, setImporting] = useState(false);
  const [assignCat, setAssignCat] = useState(null);
  const today = U.todayStr();
  const all = state.ev_tasks.filter((t) => t.event_id === ev.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
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
        <div class="muted">${[ev.client_name, ev.venue, ev.event_date && `${U.fmtDayLong(ev.event_date)}${d != null ? ` (${d >= 0 ? 'còn ' + d + ' ngày' : 'đã qua'})` : ''}`].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="row">
        ${isAdmin && html`<select value=${ev.status} onChange=${(e) => actions.saveEvent(ev.id, { status: e.target.value })}>${Object.entries(EV_STATUS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`}
        ${isAdmin && html`<button class="btn" onClick=${() => setImporting(true)}>⬆ Nhập checklist từ file</button>`}
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>${s.pct}%</b><span>Hoàn thành (${s.done}/${s.total})</span></div>
      <div class=${'stat ' + (s.overdue ? 'bad' : '')}><b>${s.overdue}</b><span>Việc quá hạn</span></div>
      <div class=${'stat ' + (s.blocked ? 'bad' : '')}><b>${s.blocked}</b><span>Đang vướng</span></div>
      <div class="stat info"><b>${s.mine}</b><span>Việc của tôi chưa xong</span></div>
    </div>
    <div class="row between mb">
      <${Seg} value=${filter} onChange=${setFilter} options=${[{ id: 'all', label: 'Tất cả' }, { id: 'mine', label: 'Của tôi' }, { id: 'open', label: 'Chưa xong' }, { id: 'late', label: 'Quá hạn' }]} />
    </div>
    ${Object.entries(PHASES).map(([ph, label]) => {
      const rows = list.filter((t) => t.phase === ph);
      const cats = [...new Set(rows.map((t) => t.category || 'Khác'))];
      const n = all.filter((t) => t.phase === ph);
      return html`<section class="section" key=${ph}>
        <div class="section-head"><h2>▶ ${label.toUpperCase()} <span class="count">${n.filter((t) => t.status === 'done').length}/${n.length}</span></h2>
          ${isAdmin && html`<button class="btn sm" onClick=${() => setAdding({ phase: ph })}>+ Thêm việc</button>`}</div>
        ${!rows.length ? html`<div class="tempty">Không có việc.</div>` : html`<div class="ledger evledger">
          <div class="lg-head"><span>Hạn</span><span>Việc</span><span>Trạng thái</span><span>Ghi chú</span><span></span></div>
          ${cats.map((c) => html`
            <div class="lg-div row between"><span>${c}</span>
              ${isAdmin && html`<button class="link small" onClick=${() => setAssignCat({ phase: ph, category: c })}>Giao cả nhóm</button>`}</div>
            ${rows.filter((t) => (t.category || 'Khác') === c).map((t) => html`<${EvRow} key=${t.id} t=${t} ctx=${ctx} staff=${staff} />`)}`)}
        </div>`}
      </section>`;
    })}
    ${adding && html`<${EvTaskForm} ctx=${ctx} ev=${ev} init=${adding} staff=${staff} onClose=${() => setAdding(null)} />`}
    ${importing && html`<${ImportChecklist} ctx=${ctx} ev=${ev} onClose=${() => setImporting(false)} />`}
    ${assignCat && html`<${AssignGroup} ctx=${ctx} ev=${ev} group=${assignCat} staff=${staff} onClose=${() => setAssignCat(null)} />`}
  </div>`;
}

export function EvRow({ t, ctx, staff, showEvent }) {
  const { me, state } = ctx;
  const isAdmin = me.role === 'admin';
  const ids = picIdsOf(t);
  const canEdit = isAdmin || ids.includes(me.id);
  const [picking, setPicking] = useState(false);
  const today = U.todayStr();
  const [note, setNote] = useState(t.note || '');
  const [edit, setEdit] = useState(false);
  useEffect(() => setNote(t.note || ''), [t.note]);
  const late = t.status !== 'done' && t.due_date && t.due_date < today;
  const pic = ids.length ? ids.map((id) => state.people.find((p) => p.id === id)?.full_name || '?').join(', ') : t.pic_name;
  const ev = showEvent && state.events.find((e) => e.id === t.event_id);
  return html`<div class=${`crow st-${t.status}${late ? ' pr-high' : ''}`}>
    <div class="c-time">${t.due_date ? U.fmtShort(t.due_date) : '—'}<small>${dLabel(t.offset_days)}</small></div>
    <div class="c-title">
      <div class="c-name">${t.title}</div>
      <div class="c-meta">
        ${ev && html`<span class="m-assign">🏆 ${ev.name}</span>`}
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
        ? html`<input class="in-note" value=${note} placeholder="Ghi chú / kết quả…" onInput=${(e) => setNote(e.target.value)} onBlur=${() => note !== (t.note || '') && actions.updateEvTask(t.id, { note })} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`
        : html`<div class=${'note-ro' + (note ? '' : ' empty-ro')}>${note || '—'}</div>`}
    </div>
    <button type="button" class="c-more" disabled=${!isAdmin} onClick=${() => setEdit(true)} title="Sửa việc">⋯</button>
    ${edit && html`<${EvTaskForm} ctx=${ctx} task=${t} staff=${staff || state.people} onClose=${() => setEdit(false)} />`}
  </div>`;
}

function EvTaskForm({ ctx, ev, task, init = {}, staff, onClose }) {
  const evx = ev || ctx.state.events.find((e) => e.id === task.event_id);
  const [f, setF] = useState({ phase: 'before', category: '', title: '', detail: '', due_date: '', sup_fp: '', sup_client: '', ...init, ...(task || {}),
    pics: task ? picIdsOf(task) : [] });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cats = [...new Set(ctx.state.ev_tasks.filter((t) => t.event_id === evx.id).map((t) => t.category).filter(Boolean))];
  function save(e) {
    e.preventDefault();
    if (!f.title.trim()) return;
    const ext = f.pics.length ? '' : extName.trim();
    const patch = {
      phase: f.phase, category: f.category || 'Khác', title: f.title.trim(), detail: f.detail || null, due_date: f.due_date || null,
      offset_days: f.due_date && evx.event_date ? U.diffDays(evx.event_date, f.due_date) : null,
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
      <div class="grid2">
        <label>Hạn chót<input id="evt-due" type="date" value=${f.due_date || ''} onInput=${set('due_date')} /></label>
      </div>
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

function AssignGroup({ ctx, ev, group, staff, onClose }) {
  const tasks = ctx.state.ev_tasks.filter((t) => t.event_id === ev.id && t.phase === group.phase && (t.category || 'Khác') === group.category);
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
