// Dashboard ผลสอบรายบุคคล ใช้ร่วมกันทั้งหน้านักเรียนและหน้าครู
export const TOPIC_SHORT = { 'พันธุกรรม': 'พันธุกรรม', 'คลื่นกลและเสียง': 'คลื่นกล/เสียง', 'คลื่นแสง': 'คลื่นแสง', 'ดาราศาสตร์': 'ดาราศาสตร์' };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtDuration(ms) {
  if (ms == null || ms < 0) return '–';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
}

export function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
}

/**
 * กราฟเรดาร์ 0–100%
 * series: [{ label, values: number[], cls: 'series-main' | 'series-compare' }]
 */
export function radarSVG(axes, series, { size = 300 } = {}) {
  const c = size / 2, r = size / 2 - 44, n = axes.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [c + Math.cos(a) * r * v / 100, c + Math.sin(a) * r * v / 100];
  };
  const ring = v => axes.map((_, i) => pt(i, v).join(',')).join(' ');
  const grid = [25, 50, 75, 100].map(v => `<polygon class="radar-grid" points="${ring(v)}"/>`).join('');
  const spokes = axes.map((_, i) => { const [x, y] = pt(i, 100); return `<line class="radar-grid" x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>`; }).join('');
  const ticks = [50, 100].map(v => `<text class="radar-tick" x="${c + 4}" y="${pt(0, v)[1] + 11}">${v}%</text>`).join('');
  const shapes = series.map(s => {
    const pts = s.values.map((v, i) => pt(i, v).join(',')).join(' ');
    const dots = s.values.map((v, i) => { const [x, y] = pt(i, v); return `<circle class="radar-dot" cx="${x}" cy="${y}" r="4.5"><title>${esc(s.label)} · ${esc(axes[i])} ${v}%</title></circle>`; }).join('');
    return `<g class="${s.cls}"><polygon class="radar-area" points="${pts}"/>${dots}</g>`;
  }).join('');
  const labels = axes.map((a, i) => {
    const [x, y] = pt(i, 122);
    const anchor = Math.abs(x - c) < 4 ? 'middle' : x > c ? 'start' : 'end';
    const main = series[0]?.values[i];
    return `<text class="radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${esc(TOPIC_SHORT[a] || a)}<tspan class="radar-value" x="${x}" dy="17">${main ?? ''}${main != null ? '%' : ''}</tspan></text>`;
  }).join('');
  return `<svg class="radar" viewBox="-75 0 ${size + 150} ${size}" role="img" aria-label="กราฟเรดาร์คะแนนรายเรื่อง: ${esc(axes.map((a, i) => `${a} ${series[0]?.values[i]}%`).join(', '))}">${grid}${spokes}${ticks}${shapes}${labels}</svg>`;
}

export function meter(pct, label = '') {
  return `<span class="meter" role="img" aria-label="${esc(label)} ${pct}%"><span style="width:${Math.max(pct, 0)}%"></span></span>`;
}

const ans = a => a && a.length ? a.join(', ') : '–';

/**
 * สร้าง HTML ของ dashboard
 * opts.compare: ค่าเฉลี่ยห้องรายเรื่อง (array ของ %) แสดงซ้อนในเรดาร์ — ใช้ในหน้าครู
 * opts.audience: 'student' | 'teacher' (เปลี่ยนสรรพนามในคำแนะนำ)
 */
export function renderResult(result, opts = {}) {
  const pct = Math.round(result.score / result.total * 100);
  const used = result.submittedAt && result.startedAt ? result.submittedAt - result.startedAt : null;
  const axes = result.topics.map(t => t.name);
  const series = [{ label: opts.mainLabel || 'คะแนนของฉัน', values: result.topics.map(t => t.pct), cls: 'series-main' }];
  if (opts.compare) series.push({ label: 'ค่าเฉลี่ยห้อง', values: opts.compare, cls: 'series-compare' });
  const you = opts.audience === 'teacher' ? 'นักเรียน' : 'เรา';
  const strengths = result.strengths.length
    ? result.strengths.map(s => `<li><span class="tag good">✓</span>${esc(s)}</li>`).join('')
    : `<li class="muted">ยังไม่มีเรื่องที่ได้ถึง 75% — ค่อย ๆ เก็บทีละเรื่อง</li>`;
  const practice = result.practice.length
    ? result.practice.map((s, i) => `<li><div class="practice-head"><span class="practice-rank">${i + 1}</span><strong>${esc(s.name)}</strong><span class="practice-score">${s.correct}/${s.total}</span></div><p>${esc(s.advice)}</p><small>${esc(s.topic)} · ข้อ ${result.items.filter(it => it.sub === s.id).map(it => it.q).join(', ')}</small></li>`).join('')
    : `<li class="muted">ทุกหัวข้อย่อยได้ 70% ขึ้นไป ยอดเยี่ยม! ลองทบทวนข้อที่ผิดด้านล่าง</li>`;
  const topicRows = result.topics.map(t => `<div class="topic-row"><span>${esc(t.name)}</span>${meter(t.pct, t.name)}<b>${t.correct}/${t.total}</b></div>`).join('');
  const subRows = result.subtopics.map(s => `<div class="sub-row"><div><span>${esc(s.name)}</span><small>${esc(s.topic)}</small></div>${meter(s.pct, s.name)}<b>${s.pct}%<small>${s.correct}/${s.total} ข้อ</small></b></div>`).join('');
  const cells = result.items.map(it => {
    const state = it.correct ? 'ok' : it.blank ? 'blank' : 'bad';
    const icon = it.correct ? '✓' : it.blank ? '–' : '✗';
    return `<li class="item ${state}" data-state="${state}"><span class="item-q">${it.q}</span><span class="item-icon" aria-hidden="true">${icon}</span><span class="item-body"><span>ตอบ <b>${ans(it.answer)}</b></span>${it.correct ? '' : `<span>เฉลย <b>${ans(it.key)}</b></span>`}</span><span class="item-topic">${esc(TOPIC_SHORT[it.topic])}</span><span class="sr-only">${it.correct ? 'ถูก' : it.blank ? 'ไม่ได้ตอบ' : 'ผิด'}</span></li>`;
  }).join('');
  return `<div class="result">
    <section class="result-hero">
      <div>
        <p class="eyebrow">${esc(result.title)}</p>
        <h2>${opts.heading ? esc(opts.heading) : 'ผลสอบของคุณ'}</h2>
        <p class="hero-meta">ส่งเมื่อ ${fmtDate(result.submittedAt)} · ใช้เวลา ${fmtDuration(used)}</p>
      </div>
      <div class="score-block"><strong>${result.score}</strong><span>/ ${result.total} คะแนน</span><em>${pct}%</em></div>
      <ul class="score-chips">
        <li><span class="tag good">✓</span>ถูก ${result.score} ข้อ</li>
        <li><span class="tag bad">✗</span>ผิด ${result.wrong} ข้อ</li>
        <li><span class="tag blank">–</span>ไม่ได้ตอบ ${result.blank} ข้อ</li>
      </ul>
    </section>
    <div class="result-grid">
      <section class="card">
        <h3>ภาพรวมรายเรื่อง</h3>
        ${radarSVG(axes, series)}
        ${opts.compare ? `<div class="chart-legend"><span><i class="lg-main"></i>${esc(series[0].label)}</span><span><i class="lg-compare"></i>ค่าเฉลี่ยห้อง</span></div>` : ''}
        <div class="topic-table">${topicRows}</div>
      </section>
      <section class="card advice">
        <h3>จุดแข็งของ${you}</h3>
        <ul class="strength-list">${strengths}</ul>
        <h3>ควรฝึกเพิ่ม <small>(หัวข้อย่อยที่ได้ต่ำกว่า 70%)</small></h3>
        <ol class="practice-list">${practice}</ol>
      </section>
    </div>
    <section class="card">
      <h3>คะแนนรายหัวข้อย่อย <small>เรียงจากที่ควรพัฒนามากที่สุด</small></h3>
      <div class="sub-table">${subRows}</div>
    </section>
    <section class="card">
      <div class="card-head"><h3>ตรวจคำตอบรายข้อ</h3>
        <div class="seg" role="group" aria-label="กรองข้อ"><button class="seg-btn active" data-filter="all" aria-pressed="true">ทั้งหมด</button><button class="seg-btn" data-filter="miss" aria-pressed="false">เฉพาะข้อที่ไม่ได้คะแนน (${result.total - result.score})</button></div>
      </div>
      <p class="hint">ข้อที่มีหลายคำตอบต้องฝนให้ตรงกับเฉลยครบทุกตัวเลือกจึงได้คะแนน</p>
      <ul class="item-grid">${cells}</ul>
    </section>
  </div>`;
}

/** ผูกปุ่มกรองข้อใน dashboard ที่แสดงอยู่ใน container */
export function bindResult(container) {
  container.querySelectorAll('.seg-btn[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    container.querySelectorAll('.seg-btn[data-filter]').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    container.querySelector('.item-grid').classList.toggle('only-miss', btn.dataset.filter === 'miss');
  }));
}
