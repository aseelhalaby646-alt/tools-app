// charts.js — dependency-free SVG donut + legend. Pure string-returning, RTL-safe.
// Handles empty (total=0), single-slice (100%), and multi-slice. No chart library.

// svgPie(data, {size, stroke}) → SVG string. data = { total, slices:[{key,label,value,color}] }.
export function svgPie(data, { size = 150, stroke = 22 } = {}) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, cx = size / 2;
  const slices = (data.slices || []).filter(s => s.value > 0);
  const total = data.total || slices.reduce((s, x) => s + x.value, 0);
  if (!total) return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="אין נתונים">`
    + `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="#3a3f4b" stroke-width="${stroke}"/>`
    + `<text x="${cx}" y="${cx}" text-anchor="middle" dominant-baseline="middle" fill="#8b98a5" font-size="13">אין נתונים</text></svg>`;
  // 100% (single non-zero slice): plain full ring, NO dash math (avoids the seam bug).
  if (slices.length === 1) {
    const s = slices[0];
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${s.label} 100% (סה״כ ${total})">`
      + `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"/>`
      + `<text x="${cx}" y="${cx}" text-anchor="middle" dominant-baseline="middle" fill="#e6edf3" font-size="20">${total}</text></svg>`;
  }
  let off = 0, arcs = '';
  const aria = slices.map(s => `${s.label} ${s.value}`).join(', ');
  for (const s of slices) {
    const len = (s.value / total) * C;
    arcs += `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"`
      + ` stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cx})">`
      + `<title>${s.label}: ${s.value} (${Math.round(s.value / total * 100)}%)</title></circle>`;
    off += len;
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${aria} (סה״כ ${total})">${arcs}`
    + `<text x="${cx}" y="${cx}" text-anchor="middle" dominant-baseline="middle" fill="#e6edf3" font-size="20">${total}</text></svg>`;
}

// Legend with value + percent as TEXT (so the chart is never colour-only — colourblind-safe).
export function svgLegend(slices, total) {
  const t = total || (slices || []).reduce((s, x) => s + x.value, 0) || 1;
  return `<div class="legend">${(slices || []).filter(s => s.value > 0).map(s =>
    `<div class="lg"><span class="sw" style="background:${s.color}"></span>${s.label}`
    + `<bdi class="lv">${s.value} (${Math.round(s.value / t * 100)}%)</bdi></div>`).join('')}</div>`;
}
