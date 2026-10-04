import { api, mountLogin, logout, getSession } from './api.js';
import { renderResult, bindResult, radarSVG, meter, esc, fmtDate, TOPIC_SHORT } from './dashboard.js';

const $ = id => document.getElementById(id);
const cache = {};
let exam = 'mahidol';
let cls = '';
let itemSort = 'hard';
let studentSort = { key: 'number', dir: 1 };

function showView(id) {
  for (const v of ['loading-view', 'login-view', 'dash-view']) $(v).hidden = v !== id;
  $('account').hidden = id !== 'dash-view';
}

function showLogin(message = '') {
  showView('login-view');
  $('login-error').textContent = message;
  mountLogin($('login-slot'), {
    onLogin: data => enter(data),
    onDenied: email => { logout(); showLogin(`${email} ไม่มีสิทธิ์เข้าหน้าครู`); },
    onError: msg => { $('login-error').textContent = msg; }
  });
}

function enter(data) {
  if (data.user.role !== 'teacher') { showLogin(`${data.user.email} เป็นบัญชีนักเรียน ไม่มีสิทธิ์เข้าหน้าครู`); return; }
  $('account-name').textContent = data.user.name;
  $('account-email').textContent = data.user.email;
  showView('dash-view');
  load();
}

async function load(force = false) {
  const body = $('dash-body');
  if (force) delete cache[exam];
  if (!cache[exam]) {
    body.innerHTML = '<div class="center-view small"><div class="spinner" aria-hidden="true"></div><p>กำลังรวบรวมผลสอบ…</p></div>';
    const id = exam;
    try { cache[id] = await api('overview', { exam: id }); }
    catch (err) {
      if (err.code === 'auth' || err.code === 'forbidden') { logout(); return showLogin('กรุณาเข้าสู่ระบบด้วยบัญชีครู'); }
      body.innerHTML = `<p class="form-error">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message)}</p>`;
      return;
    }
    if (id !== exam) return;
  }
  const data = cache[exam];
  const sel = $('class-filter');
  sel.innerHTML = '<option value="">ทุกห้อง</option>' + data.classes.map(c => `<option ${c === cls ? 'selected' : ''}>${esc(c)}</option>`).join('');
  if (cls && !data.classes.includes(cls)) cls = '';
  render();
}

/* ---------- คำนวณ ---------- */

function view() {
  const data = cache[exam];
  const students = data.students.filter(s => !cls || s.cls === cls);
  const stats = cls ? data.statsByClass[cls] : data.stats;
  const scores = students.filter(s => s.status === 'submitted').map(s => s.score).sort((a, b) => a - b);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : null;
  return { data, students, stats, scores, mean, median };
}

const fmt1 = v => v == null ? '–' : (Math.round(v * 10) / 10).toLocaleString('th-TH');

/* ---------- แสดงผล ---------- */

function render() {
  const v = view();
  const { data, students, stats, scores } = v;
  const submitted = scores.length;
  const inProgress = students.filter(s => s.status === 'in_progress').length;
  $('dash-sub').textContent = `${data.title}${cls ? ' · ห้อง ' + cls : ' · ทุกห้อง'} · ข้อมูล ณ ${fmtDate(Date.now())}`;
  const body = $('dash-body');
  if (!submitted) {
    body.innerHTML = kpis(v, submitted, inProgress) + `<section class="card empty"><h3>ยังไม่มีนักเรียนส่งชุดนี้</h3><p>เมื่อนักเรียนส่งคำตอบ สถิติจะขึ้นที่นี่ กด ↻ รีเฟรช เพื่อดูข้อมูลล่าสุด</p></section>` + studentTable(students);
    bindStudents();
    return;
  }
  const focus = stats.subtopics.slice(0, 4);
  body.innerHTML = kpis(v, submitted, inProgress) + `
    <div class="result-grid">
      <section class="card">
        <h3>การกระจายคะแนน <small>${submitted} คนที่ส่งแล้ว</small></h3>
        ${histogram(scores)}
      </section>
      <section class="card">
        <h3>ค่าเฉลี่ยห้องรายเรื่อง</h3>
        ${radarSVG(data.topics, [{ label: 'ค่าเฉลี่ยห้อง', values: stats.topics.map(t => t.pct), cls: 'series-main' }], { size: 260 })}
      </section>
    </div>
    <section class="card">
      <h3>ควรสอนเน้น <small>หัวข้อย่อยที่ห้องทำได้น้อยที่สุด</small></h3>
      <ol class="practice-list two-col">${focus.map((s, i) => `<li><div class="practice-head"><span class="practice-rank">${i + 1}</span><strong>${esc(s.name)}</strong><span class="practice-score">${s.pct}%</span></div><p>${esc(s.advice)}</p><small>${esc(s.topic)} · ข้อ ${stats.items.filter(it => it.sub === s.id).map(it => it.q).join(', ')}</small></li>`).join('')}</ol>
    </section>
    <section class="card">
      <div class="card-head"><h3>สถิติรายข้อ <small>% นักเรียนที่ตอบถูก และตัวเลือกที่ถูกฝน</small></h3>
        <div class="seg" role="group" aria-label="เรียงข้อ">
          ${[['hard', 'ผิดมากสุดก่อน'], ['easy', 'ถูกมากสุดก่อน'], ['q', 'ตามเลขข้อ']].map(([k, l]) => `<button class="seg-btn ${itemSort === k ? 'active' : ''}" data-sort="${k}" aria-pressed="${itemSort === k}">${l}</button>`).join('')}
        </div>
      </div>
      <p class="hint">ช่องตัวเลือกแสดงจำนวนคนที่ฝนตัวเลือกนั้น <span class="key-sample">ขอบส้ม</span> = ตัวเลือกในเฉลย · "ตัวลวง" คือคำตอบผิดที่เลือกกันมากที่สุด</p>
      ${itemTable(stats.items)}
    </section>
    ${studentTable(students)}`;
  body.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { itemSort = b.dataset.sort; render(); }));
  bindStudents();
}

function kpis(v, submitted, inProgress) {
  const total = v.students.length;
  const tiles = [
    ['ส่งแล้ว', `${submitted}<small>/${total} คน</small>`],
    ['กำลังทำ', `${inProgress}<small> คน</small>`],
    ['คะแนนเฉลี่ย', `${fmt1(v.mean)}<small>/40</small>`],
    ['มัธยฐาน', `${fmt1(v.median)}<small>/40</small>`],
    ['สูงสุด', `${submitted ? v.scores[v.scores.length - 1] : '–'}<small>/40</small>`],
    ['ต่ำสุด', `${submitted ? v.scores[0] : '–'}<small>/40</small>`]
  ];
  return `<div class="kpis">${tiles.map(([l, val]) => `<div class="kpi"><span>${l}</span><strong>${val}</strong></div>`).join('')}</div>`;
}

function histogram(scores) {
  const bins = Array.from({ length: 8 }, (_, i) => ({ lo: i * 5, hi: i === 7 ? 40 : i * 5 + 4, n: 0 }));
  scores.forEach(s => bins[Math.min(7, Math.floor(s / 5))].n++);
  const max = Math.max(...bins.map(b => b.n), 1);
  const W = 480, H = 220, pad = { l: 8, r: 8, t: 22, b: 34 }, bw = (W - pad.l - pad.r) / bins.length;
  const bars = bins.map((b, i) => {
    const h = (H - pad.t - pad.b) * b.n / max;
    const x = pad.l + i * bw + 3, y = H - pad.b - h;
    return `<g><title>${b.lo}–${b.hi} คะแนน: ${b.n} คน</title>
      <rect class="hist-hit" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}"/>
      ${b.n ? `<path class="hist-bar" d="M${x},${H - pad.b} V${y + 4} q0,-4 4,-4 h${bw - 14} q4,0 4,4 V${H - pad.b} Z"/>` : ''}
      ${b.n ? `<text class="hist-val" x="${x + (bw - 6) / 2}" y="${y - 6}" text-anchor="middle">${b.n}</text>` : ''}
      <text class="hist-axis" x="${x + (bw - 6) / 2}" y="${H - pad.b + 18}" text-anchor="middle">${b.lo}–${b.hi}</text></g>`;
  }).join('');
  return `<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="จำนวนนักเรียนในแต่ละช่วงคะแนน: ${bins.map(b => `${b.lo}–${b.hi} คะแนน ${b.n} คน`).join(', ')}"><line class="hist-base" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>${bars}</svg>`;
}

function itemTable(items) {
  const sorted = [...items].sort(itemSort === 'hard' ? (a, b) => a.pct - b.pct || a.q - b.q : itemSort === 'easy' ? (a, b) => b.pct - a.pct || a.q - b.q : (a, b) => a.q - b.q);
  const rows = sorted.map((it, i) => {
    const maxC = Math.max(...it.choices, 1);
    const choices = it.choices.map((n, c) => `<span class="choice ${it.key.includes(c + 1) ? 'is-key' : ''}" title="ตัวเลือก ${c + 1}: ${n} คน${it.key.includes(c + 1) ? ' (เฉลย)' : ''}"><i style="height:${Math.round(n / maxC * 100)}%"></i><b>${c + 1}</b><em>${n}</em></span>`).join('');
    return `<tr>
      <td class="num">${itemSort === 'q' ? '' : i + 1}</td>
      <td><strong>ข้อ ${it.q}</strong><small>เฉลย ${it.key.join(', ')}</small></td>
      <td class="hide-sm"><span>${esc(it.subName)}</span><small>${esc(it.topic)}</small></td>
      <td class="pct-cell">${meter(it.pct, 'ตอบถูก')}<b>${it.pct}%</b><small>${it.correct}/${it.n} คน${it.blank ? ` · เว้น ${it.blank}` : ''}</small></td>
      <td><div class="choices">${choices}</div></td>
      <td class="hide-sm">${it.topWrong ? `ตอบ <b>${esc(it.topWrong.answer.replace(/,/g, ', '))}</b><small>${it.topWrong.count} คน</small>` : '–'}</td>
    </tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="data-table items"><thead><tr><th>ลำดับ</th><th>ข้อ</th><th class="hide-sm">หัวข้อย่อย</th><th>ตอบถูก</th><th>ตัวเลือกที่ฝน</th><th class="hide-sm">ตัวลวงยอดนิยม</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

const STATUS = { submitted: 'ส่งแล้ว', in_progress: 'กำลังทำ', new: 'ยังไม่เริ่ม' };

function studentTable(students) {
  const k = studentSort.key, d = studentSort.dir;
  const val = s => k === 'score' ? (s.score ?? -1) : k === 'number' ? (Number(s.number) || 999) : k.startsWith('t') ? (s.topics ? s.topics[Number(k.slice(1))] : -1) : String(s[k] || '');
  const sorted = [...students].sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === 'number' ? x - y : x.localeCompare(y, 'th')) * d || String(a.cls).localeCompare(String(b.cls)) || (Number(a.number) - Number(b.number));
  });
  const topics = cache[exam].topics;
  const th = (key, label, extra = '') => `<th ${extra} aria-sort="${k === key ? (d > 0 ? 'ascending' : 'descending') : 'none'}"><button class="sort-btn" data-skey="${key}">${label}${k === key ? (d > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  const rows = sorted.map(s => `<tr class="${s.status === 'submitted' ? 'clickable' : ''}" ${s.status === 'submitted' ? `data-email="${esc(s.email)}" tabindex="0"` : ''}>
    <td class="num">${esc(s.number)}</td>
    <td><strong>${esc(s.name)}</strong><small>${esc(s.email)}</small></td>
    <td>${esc(s.cls)}</td>
    <td><span class="status ${s.status}">${STATUS[s.status]}${s.status === 'in_progress' && s.answered != null ? ` · ${s.answered}/40` : ''}</span></td>
    <td class="score">${s.score ?? '–'}</td>
    ${topics.map((_, i) => `<td class="hide-sm tpct">${s.topics ? s.topics[i] + '%' : '–'}</td>`).join('')}
    <td class="go">${s.status === 'submitted' ? 'ดูผล →' : ''}</td>
  </tr>`).join('');
  return `<section class="card">
    <h3>รายบุคคล <small>คลิกชื่อนักเรียนที่ส่งแล้วเพื่อดู Dashboard ของคนนั้น</small></h3>
    <div class="table-scroll"><table class="data-table students"><thead><tr>${th('number', 'เลขที่')}${th('name', 'ชื่อ')}${th('cls', 'ห้อง')}${th('status', 'สถานะ')}${th('score', 'คะแนน')}${topics.map((t, i) => th('t' + i, esc(TOPIC_SHORT[t]), 'class="hide-sm"')).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function bindStudents() {
  const body = $('dash-body');
  body.querySelectorAll('[data-skey]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.skey;
    studentSort = { key, dir: studentSort.key === key ? -studentSort.dir : (key === 'score' || key.startsWith('t') ? -1 : 1) };
    render();
  }));
  body.querySelectorAll('tr[data-email]').forEach(tr => {
    const open = () => openStudent(tr.dataset.email);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

async function openStudent(email) {
  const box = $('student-detail');
  box.innerHTML = '<div class="center-view small"><div class="spinner" aria-hidden="true"></div></div>';
  $('student-dialog').showModal();
  try {
    const { student, result } = await api('studentResult', { email, exam });
    const s = cache[exam].students.find(x => x.email === email) || student || {};
    const avg = view().stats.topics.map(t => t.pct);
    box.innerHTML = renderResult(result, {
      audience: 'teacher', heading: `${s.name || email}`, mainLabel: s.name || 'นักเรียน',
      compare: avg
    }).replace('<p class="hero-meta">', `<p class="hero-meta">${esc([s.cls && 'ห้อง ' + s.cls, s.number && 'เลขที่ ' + s.number, email].filter(Boolean).join(' · '))}<br>`);
    bindResult(box);
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

/* ---------- ส่งออก CSV ---------- */

function download(name, rows) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('export-scores').addEventListener('click', () => {
  if (!cache[exam]) return;
  const { students } = view();
  const topics = cache[exam].topics;
  download(`คะแนน_${exam}${cls ? '_' + cls.replace(/\//g, '-') : ''}.csv`, [
    ['เลขที่', 'ชื่อ', 'ห้อง', 'อีเมล', 'สถานะ', 'คะแนน (40)', ...topics.map(t => t + ' (%)'), 'ส่งเมื่อ'],
    ...students.map(s => [s.number, s.name, s.cls, s.email, STATUS[s.status], s.score ?? '', ...topics.map((_, i) => s.topics ? s.topics[i] : ''), s.submittedAt ? fmtDate(s.submittedAt) : ''])
  ]);
});
$('export-items').addEventListener('click', () => {
  if (!cache[exam]) return;
  const { stats } = view();
  download(`สถิติรายข้อ_${exam}${cls ? '_' + cls.replace(/\//g, '-') : ''}.csv`, [
    ['ข้อ', 'เฉลย', 'เรื่อง', 'หัวข้อย่อย', 'ตอบถูก (%)', 'ตอบถูก (คน)', 'ส่งแล้ว (คน)', 'ไม่ตอบ (คน)', 'ฝน 1', 'ฝน 2', 'ฝน 3', 'ฝน 4', 'ฝน 5', 'ตัวลวงยอดนิยม', 'จำนวนตัวลวง'],
    ...stats.items.map(it => [it.q, it.key.join(' '), it.topic, it.subName, it.pct, it.correct, it.n, it.blank, ...it.choices, it.topWrong ? it.topWrong.answer.replace(/,/g, ' ') : '', it.topWrong ? it.topWrong.count : ''])
  ]);
});

/* ---------- ควบคุม ---------- */

document.querySelectorAll('.toolbar [data-exam]').forEach(b => b.addEventListener('click', () => {
  exam = b.dataset.exam;
  document.querySelectorAll('.toolbar [data-exam]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  load();
}));
$('class-filter').addEventListener('change', e => { cls = e.target.value; render(); });
$('refresh').addEventListener('click', () => load(true));
$('logout').addEventListener('click', () => { logout(); location.reload(); });

(async function init() {
  if (!getSession()) return showLogin();
  try { enter(await api('me')); }
  catch (err) { if (err.code === 'auth') logout(); showLogin(err.code === 'auth' ? '' : 'เชื่อมต่อระบบไม่สำเร็จ: ' + err.message); }
})();
