// ============================================================
// render.js
// دوال مساعدة لبناء عناصر DOM من نتائج التحليل. طبقة عرض بحتة —
// لا تحتوي على أي منطق تحليل أو تخزين.
// ============================================================
import { RiskLevel } from '../core/models.js';

export const LEVEL_META = {
  [RiskLevel.GREEN]: { color: 'var(--green)', title: 'لم تظهر مؤشرات خطر واضحة', chip: '🟢' },
  [RiskLevel.YELLOW]: { color: 'var(--yellow)', title: 'يحتاج إلى تحقق', chip: '🟡' },
  [RiskLevel.RED]: { color: 'var(--red)', title: 'خطر محتمل', chip: '🔴' },
};
export const UNAVAILABLE_META = { color: 'var(--gray)', title: 'تعذر الفحص', chip: '⚪' };

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function renderScoreRing(score, level) {
  const meta = LEVEL_META[level] || UNAVAILABLE_META;
  const r = 65;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const wrap = el('div', { class: 'score-ring-wrap' });
  wrap.innerHTML = `
    <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="درجة الثقة ${score} من 100">
      <circle class="score-ring-track" cx="75" cy="75" r="${r}"></circle>
      <circle class="score-ring-fill" cx="75" cy="75" r="${r}"
        style="stroke:${meta.color}; stroke-dasharray:${c}; stroke-dashoffset:${offset};"></circle>
    </svg>
    <div class="score-ring-value"><strong>${score}</strong><span>من 100</span></div>
  `;
  return wrap;
}

export function renderBadge(level) {
  const meta = LEVEL_META[level] || UNAVAILABLE_META;
  return el(
    'div',
    { class: 'badge risk-badge', style: `background:${meta.color}1a;border:1px solid ${meta.color}66;color:${meta.color};` },
    [meta.chip + ' ' + meta.title]
  );
}

export function renderSimulatedBadge() {
  return el('div', { class: 'badge badge-simulated' }, ['🧪 وضع تجريبي — تحليل محاكاة (Simulated)']);
}

export function renderInfoSection(title, items) {
  const ul = el(
    'ul',
    {},
    items.map((t) => el('li', {}, [t]))
  );
  return el('div', { class: 'info-section' }, [el('h4', {}, [title]), ul]);
}

export function renderCheckSection(title, iconEmoji, items) {
  const rows = items.map((it) => {
    const icon = it.ok === true ? '✓' : it.ok === false ? '⚠️' : 'ℹ️';
    return el('div', { class: 'check-row' }, [el('span', {}, [icon]), el('span', {}, [it.label])]);
  });
  return el('div', { class: 'check-section' }, [
    el('div', { class: 'check-section-head' }, [iconEmoji + ' ' + title]),
    ...rows,
  ]);
}

export function renderHistoryRow(entry, { onOpen, onDelete }) {
  const meta = LEVEL_META[entry.level] || UNAVAILABLE_META;
  const date = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' });
  const timeStr = date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

  const delBtn = el('span', { role: 'button', tabindex: '0', 'aria-label': 'حذف العملية', class: 'icon-btn', style: 'width:30px;height:30px;' }, ['🗑️']);
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete(entry.id);
  });

  const row = el('div', { class: 'history-row', role: 'button', tabindex: '0' }, [
    el('div', { class: 'history-icon', style: `background:${meta.color}1a;` }, [meta.chip]),
    el('div', { class: 'history-mid' }, [
      el('strong', { style: `color:${meta.color};` }, [meta.chip + ' ' + meta.title]),
      el('span', {}, [`${entry.score}/100 · ${entry.type === 'qr' ? 'QR' : 'رابط'}`]),
    ]),
    el('div', { class: 'history-right' }, [el('span', { class: 'history-date' }, [`${dateStr}، ${timeStr}`]), delBtn]),
  ]);
  row.addEventListener('click', () => onOpen(entry));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') onOpen(entry);
  });
  return row;
}

export function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

export { el };
