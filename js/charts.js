// Hand-rolled SVG charts (no library). Points/bars carry data-tip for the shared tooltip
// and data-href to navigate on click.
import { esc, fmtPct } from './util.js';

const W = 640;

/** Pass-rate line across runs. points: [{label, value (0-100), tip, href, current}] */
export function lineChart(points, { height = 200, yMinFloor = 0 } = {}) {
  if (!points.length) return '<div class="empty">No runs yet</div>';
  const pad = { l: 40, r: 14, t: 14, b: 28 };
  const H = height;
  const vals = points.map((p) => p.value);
  let lo = Math.max(yMinFloor, Math.floor((Math.min(...vals) - 5) / 5) * 5);
  if (lo > 90) lo = 90;
  const hi = 100;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  const ticks = [];
  const step = hi - lo <= 20 ? 5 : 10;
  for (let v = lo; v <= hi; v += step) ticks.push(v);

  const grid = ticks.map((v) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${path}L${x(points.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`;
  const everyN = Math.ceil(points.length / 8);
  const labels = points.map((p, i) => (i % everyN === 0 || i === points.length - 1 ? `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>` : '')).join('');
  const dots = points.map((p, i) => `<circle class="pt${p.current ? ' current' : ''}" cx="${x(i)}" cy="${y(p.value)}" r="${p.current ? 5.5 : 4.5}" data-tip="${esc(p.tip)}" ${p.href ? `data-href="${esc(p.href)}" tabindex="0" role="link" aria-label="${esc(p.tip)}"` : ''}/>`).join('');

  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pass rate trend: ${points.map((p) => `${p.label} ${fmtPct(p.value)}`).join(', ')}">${grid}<path class="area" d="${area}"/><path class="line" d="${path}"/>${labels}${dots}</svg></div>`;
}

/** Stacked failed/flaky bars per run. bars: [{label, failed, flaky, tip, href, current}] */
export function barChart(bars, { height = 180 } = {}) {
  if (!bars.length) return '<div class="empty">No runs yet</div>';
  const pad = { l: 34, r: 10, t: 10, b: 28 };
  const H = height;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(4, ...bars.map((b) => b.failed + b.flaky));
  const niceMax = Math.ceil(max / 4) * 4;
  const slot = iw / bars.length;
  const bw = Math.min(36, slot * 0.6);
  const y = (v) => pad.t + ih - (v / niceMax) * ih;
  const grid = [0, niceMax / 2, niceMax].map((v) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const everyN = Math.ceil(bars.length / 8);
  const rects = bars.map((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const x0 = cx - bw / 2;
    const fh = (b.failed / niceMax) * ih;
    const kh = (b.flaky / niceMax) * ih;
    const base = pad.t + ih;
    const attrs = `data-tip="${esc(b.tip)}" ${b.href ? `data-href="${esc(b.href)}"` : ''} style="cursor:${b.href ? 'pointer' : 'default'}"`;
    const outline = b.current ? `<rect x="${x0 - 3}" y="${base - fh - kh - 3}" width="${bw + 6}" height="${fh + kh + 3}" fill="none" stroke="currentColor" stroke-width="1.5" rx="3" style="color:var(--text-3)"/>` : '';
    return `<g ${attrs}><rect x="${cx - slot / 2}" y="${pad.t}" width="${slot}" height="${ih}" fill="transparent"/>${outline}<rect class="bar-failed" x="${x0}" y="${base - fh}" width="${bw}" height="${Math.max(fh, 0)}" rx="2"/><rect class="bar-flaky" x="${x0}" y="${base - fh - kh}" width="${bw}" height="${Math.max(kh, 0)}" rx="2"/></g>${i % everyN === 0 || i === bars.length - 1 ? `<text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>` : ''}`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Failed and flaky tests per run">${grid}${rects}</svg></div>`;
}

/** One shared tooltip + click-to-navigate for every chart on the page. */
export function installChartInteractions(root) {
  let tip = document.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  root.addEventListener('mousemove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t || !root.contains(t)) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + 12;
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${e.clientY - r.height - 10}px`;
  });
  root.addEventListener('mouseleave', () => (tip.hidden = true));
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-href]');
    if (t) { tip.hidden = true; location.hash = t.dataset.href; }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target.closest('[data-href]');
    if (t) location.hash = t.dataset.href;
  });
}
