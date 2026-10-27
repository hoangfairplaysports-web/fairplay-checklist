// Khối "Gợi ý hôm nay" trên màn Hôm nay: AI đề xuất việc mới để phát triển (kinh doanh, marketing, bản thân).
// Mỗi gợi ý: thêm vào checklist hôm nay, đánh giá 👍/👎 (AI học dần), hoặc bỏ qua.
import { html } from './ui.js';
import { useState } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { actions } from './store.js';
import * as U from './util.js';

const AREA = {
  sales: { label: 'Kinh doanh', cls: 'ia-sales' },
  mkt: { label: 'Marketing', cls: 'ia-mkt' },
  growth: { label: 'Phát triển bản thân', cls: 'ia-growth' },
  ops: { label: 'Vận hành', cls: 'ia-ops' },
};

export function IdeasCard({ ctx, person }) {
  const today = U.todayStr();
  const all = (ctx.state.ideas || []).filter((i) => i.owner_id === person.id && i.date === today);
  const visible = all.filter((i) => i.status !== 'dismissed');
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  async function more() {
    setBusy(true);
    try {
      await actions.moreIdeas(person.id);
    } catch (e) {
      ctx.notify(e.message);
    }
    setBusy(false);
  }

  return html`<section class="section ideas">
    <div class="section-head">
      <h2>💡 Gợi ý hôm nay</h2>
      <div class="row">
        ${all.length > 0 && html`<button class="link" onClick=${() => setHidden(!hidden)}>${hidden ? 'Mở' : 'Thu gọn'}</button>`}
        <button class="btn sm" disabled=${busy || all.length >= 9} onClick=${more}>${busy ? 'Đang nghĩ…' : '✨ Gợi ý thêm'}</button>
      </div>
    </div>
    ${!hidden && html`
      ${all.length === 0 && html`<div class="card pad muted small">Gợi ý mới được tạo lúc 7:30 sáng (thứ 2 – thứ 7). Bấm <b>Gợi ý thêm</b> để tạo ngay.</div>`}
      ${all.length > 0 && visible.length === 0 && html`<div class="card pad muted small">Bạn đã xem hết gợi ý hôm nay. Bấm <b>Gợi ý thêm</b> nếu muốn có ý tưởng khác.</div>`}
      <div class="idea-list">${visible.map((i) => html`<${IdeaRow} key=${i.id} idea=${i} ctx=${ctx} />`)}</div>
    `}
  </section>`;
}

function IdeaRow({ idea, ctx }) {
  const [open, setOpen] = useState(false);
  const a = AREA[idea.area] || AREA.growth;
  const added = idea.status === 'added';
  const add = () => {
    actions.ideaToTask(idea);
    ctx.notify('Đã thêm vào việc hôm nay');
  };
  const rate = (v) => actions.ideaSet(idea.id, { feedback: idea.feedback === v ? null : v });
  const steps = (idea.steps || '').split('\n').map((s) => s.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);

  return html`<div class=${'card idea' + (added ? ' added' : '')}>
    <div class="idea-top" onClick=${() => setOpen(!open)}>
      <div class="idea-meta"><span class=${'tag ' + a.cls}>${a.label}</span>${idea.effort && html`<span class="muted small">⏱ ${idea.effort}</span>`}</div>
      <div class="idea-title">${idea.title}</div>
      ${idea.why && html`<div class="idea-why">${idea.why}</div>`}
    </div>
    ${open && steps.length > 0 && html`<ol class="idea-steps">${steps.map((s) => html`<li>${s}</li>`)}</ol>`}
    <div class="idea-actions">
      ${added
        ? html`<span class="ok-t small">✓ Đã thêm vào việc hôm nay</span>`
        : html`<button class="btn sm primary" onClick=${add}>＋ Thêm vào hôm nay</button>`}
      ${steps.length > 0 && html`<button class="link" onClick=${() => setOpen(!open)}>${open ? 'Ẩn cách làm' : 'Cách làm'}</button>`}
      <span class="grow"></span>
      <button class=${'icon-btn' + (idea.feedback === 1 ? ' on' : '')} title="Gợi ý hay — AI sẽ đề xuất kiểu này nhiều hơn" onClick=${() => rate(1)}>👍</button>
      <button class=${'icon-btn' + (idea.feedback === -1 ? ' on' : '')} title="Không hợp — AI sẽ tránh kiểu này" onClick=${() => rate(-1)}>👎</button>
      ${!added && html`<button class="link muted" onClick=${() => actions.ideaSet(idea.id, { status: 'dismissed' })}>Bỏ qua</button>`}
    </div>
  </div>`;
}
