import { html } from './ui.js';
import * as U from './util.js';

// Khối số liệu "Tìm khách mới" (tự lấy từ CRM) cho báo cáo ngày và tab Tuần này
export function CrmBlock({ state, person, from, to, title }) {
  const m = U.crmSum(state, person.id, from, to);
  const keys = ['new_companies', 'sequences', 'touches', 'replies', 'meetings', 'briefs'];
  if (!keys.some((k) => m[k]) && !U.hasCrmKpi(state, person.id)) return null;
  const SHORT = { new_companies: 'DN mới vào chuỗi', sequences: 'Người vào chuỗi', touches: 'Lần chạm', replies: 'Phản hồi', meetings: 'Cuộc hẹn', briefs: 'Brief' };
  return html`<div class="crmblock">
    <h4>🎯 ${title || 'Tìm khách mới'} <span class="muted small">· tự lấy từ CRM</span></h4>
    <div class="crmnums">${keys.map((k) => html`<span><b>${m[k] || 0}</b> ${SHORT[k]}</span>`)}
      ${m.touch_ontime_pct != null && html`<span class=${m.touch_ontime_pct < 80 ? 'bad-t' : ''}><b>${m.touch_ontime_pct}%</b> chạm đúng hạn</span>`}</div>
  </div>`;
}
