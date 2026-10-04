import { api, mountLogin, logout, getSession } from './api.js';
import { renderResult, bindResult, esc } from './dashboard.js';
import { QUESTIONS, CHOICES, emptyAnswers, toggleChoice, countAnswered, sameAnswers, remainingMs, formatClock } from './sheet-logic.js';

const $ = id => document.getElementById(id);
const exams = {
  mahidol: { title: 'แนวข้อสอบมหิดลวิทย์', code: '01' },
  triam: { title: 'แนวข้อสอบเตรียมอุดม', code: '02' }
};
for (const e of Object.values(exams)) Object.assign(e, { state: { status: 'new' }, answers: emptyAnswers(), result: null, dirty: false, inFlight: null, saveTimer: null, warned: {} });
let user = null;
let examMinutes = 90;
let clockOffset = 0;
let activeExam = 'mahidol';
let soundEnabled = true;
let audioContext;
const current = () => exams[activeExam];

/* ---------- มุมมองหลัก ---------- */

function showView(id) {
  document.body.classList.remove('is-loading');
  for (const v of ['loading-view', 'login-view', 'denied-view', 'exam-view']) $(v).hidden = v !== id;
  $('account').hidden = id !== 'exam-view';
  if (id !== 'exam-view') $('bottom-bar').hidden = true;
}

function toast(message) {
  const t = $('toast');
  t.textContent = message; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4500);
}

function showLogin(message = '') {
  showView('login-view');
  $('login-error').textContent = message;
  mountLogin($('login-slot'), {
    onLogin: data => applyMe(data),
    onDenied: email => { logout(); $('denied-email').textContent = email; showView('denied-view'); },
    onError: msg => { $('login-error').textContent = msg; }
  });
}

/* ---------- ข้อมูลผู้ใช้และสถานะชุดข้อสอบ ---------- */

const backupKey = id => `wsl-draft:${user.email}:${id}`;
function readBackup(id) { try { return JSON.parse(localStorage.getItem(backupKey(id)) || 'null'); } catch (_) { return null; } }
function writeBackup(id, saved) {
  try { localStorage.setItem(backupKey(id), JSON.stringify({ answers: exams[id].answers, saved, t: Date.now() })); } catch (_) { /* ไม่มีที่เก็บในเครื่องก็ยังบันทึกบนเซิร์ฟเวอร์ได้ */ }
}
function clearBackup(id) { try { localStorage.removeItem(backupKey(id)); } catch (_) { /* ไม่มีผล */ } }

function applyMe(data) {
  const sameUser = user && user.email === data.user.email;
  user = data.user;
  examMinutes = data.examMinutes || 90;
  clockOffset = data.serverNow - Date.now();
  for (const [id, st] of Object.entries(data.exams)) {
    const e = exams[id];
    e.state = st;
    if (st.status === 'in_progress') {
      // กลับมาหลังเซสชันหมดอายุในหน้าเดิม: คำตอบในหน้านี้ใหม่กว่าเสมอ
      const local = sameUser ? { answers: e.answers, saved: !e.dirty } : readBackup(id);
      e.answers = st.answers || emptyAnswers();
      if (local && !local.saved && !sameAnswers(local.answers, e.answers)) { e.answers = local.answers; queueSave(id); }
    } else if (st.status === 'submitted') {
      clearBackup(id);
    }
  }
  $('account-name').textContent = user.name;
  $('account-email').textContent = user.email;
  $('teacher-link').hidden = user.role !== 'teacher';
  $('paper-name').textContent = user.name;
  $('paper-class').textContent = [user.cls, user.number && 'เลขที่ ' + user.number].filter(Boolean).join(' · ') || '–';
  $('greeting').innerHTML = `สวัสดี ${esc(user.name.split(' ')[0])}<span class="orange">.</span>`;
  showView('exam-view');
  render();
}

/* ---------- เสียงฝนดินสอ ---------- */

function pencilSound(erasing = false) {
  if (!soundEnabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    const duration = erasing ? .17 : .26;
    const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * duration), audioContext.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const t = i / samples.length;
      const scrape = .3 + .7 * Math.pow(Math.sin(t * Math.PI * 5), 2);
      samples[i] = (Math.random() * 2 - 1) * scrape * Math.sin(Math.PI * t);
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = erasing ? 900 : 2600; filter.Q.value = .65;
    const gain = audioContext.createGain(); gain.gain.value = .22;
    source.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start();
  } catch (_) { /* Answering remains available when browser audio is unavailable. */ }
}

/* ---------- การแสดงผล ---------- */

function tabStatusText(e) {
  const s = e.state;
  if (s.status === 'submitted') return `ส่งแล้ว · ได้ ${s.score}/${QUESTIONS} คะแนน`;
  if (s.status === 'in_progress') return `กำลังทำ · ตอบแล้ว ${countAnswered(e.answers)}/${QUESTIONS}`;
  return 'ยังไม่เริ่ม · 40 ข้อ';
}

function render() {
  const exam = current();
  document.querySelectorAll('.exam-tab').forEach(tab => {
    const selected = tab.dataset.exam === activeExam;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-status-for]').forEach(el => { el.textContent = tabStatusText(exams[el.dataset.statusFor]); });
  $('exam-panel').setAttribute('aria-labelledby', 'tab-' + activeExam);
  const status = exam.state.status;
  $('start-view').hidden = status !== 'new';
  $('sheet-view').hidden = status !== 'in_progress';
  $('result-view').hidden = status !== 'submitted';
  $('bottom-bar').hidden = status !== 'in_progress';
  document.body.classList.toggle('has-bottom-bar', status === 'in_progress');
  if (status === 'new') {
    $('start-title').textContent = exam.title;
  } else if (status === 'in_progress') {
    renderSheet();
  } else {
    renderResultView();
  }
  tick();
}

function renderSheet() {
  const exam = current();
  $('exam-title').textContent = exam.title;
  $('sheet-code').textContent = 'ANSWER SHEET / ' + exam.code;
  $('paper-code').textContent = 'WSL — ' + exam.code;
  $('answer-grid').innerHTML = Array.from({ length: 4 }, (_, group) => {
    const start = group * 10;
    return `<section class="answer-group" aria-label="ข้อ ${start + 1} ถึง ${start + 10}"><div class="group-header"><strong>ข้อ ${String(start + 1).padStart(2, '0')} – ${start + 10}</strong><span>เลือกได้หลายคำตอบ</span></div>${Array.from({ length: 10 }, (_, offset) => {
      const q = start + offset;
      return `<div class="answer-row" id="question-${q + 1}" role="group" aria-label="ข้อ ${q + 1} เลือกได้หลายคำตอบ"><span class="q-number" aria-hidden="true">${String(q + 1).padStart(2, '0')}</span>${Array.from({ length: CHOICES }, (_, option) => `<button class="bubble-button" role="checkbox" aria-checked="${exam.answers[q].includes(option + 1)}" aria-label="ข้อ ${q + 1} ตัวเลือก ${option + 1}" data-question="${q}" data-choice="${option + 1}" tabindex="0"><span class="bubble" aria-hidden="true">${option + 1}</span></button>`).join('')}</div>`;
    }).join('')}</section>`;
  }).join('');
  $('question-map').innerHTML = Array.from({ length: QUESTIONS }, (_, i) => `<button class="map-button" data-jump="${i + 1}">${i + 1}</button>`).join('');
  updateProgress();
}

function updateProgress() {
  const exam = current();
  const count = countAnswered(exam.answers);
  $('answered-count').textContent = count;
  $('answer-progress').value = count;
  $('remaining-label').textContent = count === QUESTIONS ? 'ตอบครบแล้ว พร้อมตรวจทาน' : `ยังไม่ได้ตอบ ${QUESTIONS - count} ข้อ`;
  $('bottom-count').textContent = `ตอบแล้ว ${count} จาก ${QUESTIONS} ข้อ`;
  $('first-blank').disabled = count === QUESTIONS;
  $('first-blank').textContent = count === QUESTIONS ? 'ตอบครบทุกข้อแล้ว' : 'ไปข้อที่ยังไม่ได้ตอบ';
  document.querySelectorAll('.map-button').forEach(button => {
    const q = Number(button.dataset.jump);
    const answer = exam.answers[q - 1];
    button.classList.toggle('done', answer.length > 0);
    button.setAttribute('aria-label', `ไปข้อ ${q} ${answer.length > 0 ? 'เลือก ' + answer.join(', ') : 'ยังไม่ตอบ'}`);
  });
  const tabStatus = document.querySelector(`[data-status-for="${activeExam}"]`);
  if (tabStatus) tabStatus.textContent = tabStatusText(exam);
}

async function renderResultView() {
  const exam = current();
  const box = $('result-view');
  if (!exam.result) {
    box.innerHTML = '<div class="center-view small"><div class="spinner" aria-hidden="true"></div><p>กำลังโหลดผลสอบ…</p></div>';
    const id = activeExam;
    try {
      exams[id].result = (await api('result', { exam: id })).result;
    } catch (err) {
      if (err.code === 'auth') return sessionExpired();
      box.innerHTML = `<p class="form-error">โหลดผลสอบไม่สำเร็จ: ${esc(err.message)} <button class="text-button inline" id="retry-result">ลองใหม่</button></p>`;
      $('retry-result').onclick = () => renderResultView();
      return;
    }
    if (activeExam !== id) return;
  }
  box.innerHTML = renderResult(exam.result, { audience: 'student' });
  bindResult(box);
}

/* ---------- เวลา ---------- */

function tick() {
  const exam = current();
  if (exam.state.status !== 'in_progress' || !exam.state.startedAt) return;
  const left = remainingMs(exam.state.startedAt, examMinutes, Date.now() + clockOffset);
  const text = left >= 0 ? formatClock(left) : 'หมดเวลา ' + formatClock(left);
  $('timer').textContent = text;
  $('bottom-timer').textContent = left >= 0 ? 'เหลือ ' + formatClock(left) : 'เกินเวลาแนะนำ ' + formatClock(left);
  $('timer-box').classList.toggle('low', left < 10 * 60000 && left >= 0);
  $('timer-box').classList.toggle('over', left < 0);
  if (left < 10 * 60000 && left >= 0 && !exam.warned.ten) { exam.warned.ten = true; toast('เหลือเวลาอีก 10 นาที อย่าลืมตรวจข้อที่ยังไม่ได้ตอบ'); }
  if (left < 0 && !exam.warned.over) { exam.warned.over = true; toast('ครบ 90 นาทีแล้ว ตรวจทานแล้วกดส่งคำตอบได้เลย'); }
}
setInterval(tick, 1000);

/* ---------- บันทึกอัตโนมัติ ---------- */

function setSaveState(state) {
  const labels = { saved: 'บันทึกแล้ว ✓', pending: 'รอบันทึก…', saving: 'กำลังบันทึก…', offline: 'ออฟไลน์ — เก็บในเครื่องไว้ก่อน' };
  $('save-state').textContent = labels[state];
  $('save-state').dataset.state = state;
  $('save-detail').textContent = state === 'offline'
    ? 'ยังส่งคำตอบล่าสุดขึ้นระบบไม่ได้ คำตอบเก็บอยู่ในเครื่องนี้ และจะบันทึกให้อัตโนมัติเมื่อกลับมาออนไลน์'
    : 'คำตอบบันทึกอัตโนมัติทุกครั้งที่ฝน ปิดหน้าแล้วกลับมาทำต่อได้';
}

function queueSave(id) {
  const e = exams[id];
  e.dirty = true;
  writeBackup(id, false);
  setSaveState('pending');
  clearTimeout(e.saveTimer);
  e.saveTimer = setTimeout(() => flush(id), 2500);
}

async function flush(id) {
  const e = exams[id];
  clearTimeout(e.saveTimer); e.saveTimer = null;
  if (e.inFlight) { await e.inFlight; return e.dirty ? flush(id) : undefined; }
  if (!e.dirty || e.state.status !== 'in_progress') return;
  e.dirty = false;
  const snapshot = e.answers.map(a => [...a]);
  setSaveState('saving');
  e.inFlight = api('save', { exam: id, answers: snapshot }).then(() => {
    if (!e.dirty) { writeBackup(id, true); setSaveState('saved'); }
  }).catch(err => {
    e.dirty = true;
    if (err.code === 'auth') { sessionExpired(); return; }
    if (err.code === 'already_submitted') { reloadMe(); return; }
    setSaveState('offline');
    e.saveTimer = setTimeout(() => flush(id), 8000);
  }).finally(() => { e.inFlight = null; });
  await e.inFlight;
  if (e.dirty && !e.saveTimer && e.state.status === 'in_progress') e.saveTimer = setTimeout(() => flush(id), 1000);
}

const flushAll = () => Object.keys(exams).forEach(id => { if (exams[id].dirty) flush(id); });
addEventListener('online', flushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
addEventListener('beforeunload', e => { if (Object.values(exams).some(x => x.dirty || x.inFlight)) { flushAll(); e.preventDefault(); } });

function sessionExpired() {
  showLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง — คำตอบที่ฝนไว้ยังอยู่ครบ');
}

async function reloadMe() {
  try { applyMe(await api('me')); } catch (err) { if (err.code === 'auth') sessionExpired(); }
}

/* ---------- การกระทำของผู้ใช้ ---------- */

function chooseAnswer(q, choice, toggle = true) {
  if (current().state.status !== 'in_progress') throw new Error('ชุดนี้ยังไม่เปิดให้ฝน');
  if (!Number.isInteger(q) || q < 0 || q >= QUESTIONS) throw new Error('คำตอบไม่ถูกต้อง');
  const { next, erasing } = toggleChoice(current().answers[q], choice, toggle);
  current().answers[q] = next;
  document.querySelectorAll(`#question-${q + 1} .bubble-button`).forEach(button => {
    button.setAttribute('aria-checked', String(next.includes(Number(button.dataset.choice))));
  });
  pencilSound(erasing);
  updateProgress();
  queueSave(activeExam);
  $('announcement').textContent = erasing ? `ข้อ ${q + 1} ลบตัวเลือก ${choice} แล้ว` : `ข้อ ${q + 1} เลือกตัวเลือก ${choice}`;
}

function jumpTo(q) {
  const row = $('question-' + q);
  row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const button = row.querySelector('[tabindex="0"]');
  if (button) button.focus({ preventScroll: true });
  row.classList.add('just-changed');
  setTimeout(() => row.classList.remove('just-changed'), 1000);
}

function selectExam(id) { activeExam = id; render(); }

document.querySelectorAll('.exam-tab').forEach(tab => {
  tab.addEventListener('click', () => selectExam(tab.dataset.exam));
  tab.addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      selectExam(e.key === 'Home' ? 'mahidol' : e.key === 'End' ? 'triam' : activeExam === 'mahidol' ? 'triam' : 'mahidol');
      $('tab-' + activeExam).focus();
    }
  });
});

$('start-button').addEventListener('click', async () => {
  const id = activeExam;
  const btn = $('start-button');
  btn.disabled = true;
  try {
    const data = await api('start', { exam: id });
    clockOffset = data.serverNow - Date.now();
    exams[id].state = data.state;
    exams[id].answers = data.state.answers || emptyAnswers();
    setSaveState('saved');
    render();
    $('answer-panel').scrollIntoView({ block: 'start' });
  } catch (err) {
    if (err.code === 'auth') sessionExpired(); else toast('เริ่มสอบไม่สำเร็จ: ' + err.message);
  } finally { btn.disabled = false; }
});

$('answer-grid').addEventListener('click', e => {
  const button = e.target.closest('.bubble-button');
  if (button) chooseAnswer(Number(button.dataset.question), Number(button.dataset.choice));
});
$('answer-grid').addEventListener('keydown', e => {
  const button = e.target.closest('.bubble-button');
  if (!button) return;
  const q = Number(button.dataset.question), value = Number(button.dataset.choice);
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const next = e.key === 'Home' ? 1 : e.key === 'End' ? CHOICES : ((value - 1 + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? CHOICES - 1 : 1)) % CHOICES) + 1;
    document.querySelector(`[data-question="${q}"][data-choice="${next}"]`).focus();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (current().answers[q].includes(value)) chooseAnswer(q, value); }
});
$('question-map').addEventListener('click', e => { const button = e.target.closest('[data-jump]'); if (button) jumpTo(Number(button.dataset.jump)); });
$('first-blank').addEventListener('click', () => { const q = current().answers.findIndex(a => a.length === 0); if (q >= 0) jumpTo(q + 1); });
$('sound-toggle').addEventListener('click', () => { soundEnabled = !soundEnabled; $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled)); if (soundEnabled) pencilSound(); });

$('review-button').addEventListener('click', () => {
  const missing = current().answers.flatMap((v, i) => v.length === 0 ? [i + 1] : []);
  $('review-description').textContent = `${current().title} · ตอบแล้ว ${QUESTIONS - missing.length} จาก ${QUESTIONS} ข้อ${missing.length ? ' ยังเหลือข้อที่ไม่ได้ตอบดังนี้ (แตะเพื่อกลับไปตอบ)' : ' ตรวจครบแล้ว สามารถยืนยันส่งได้เลย'}`;
  $('missing-list').innerHTML = missing.map(q => `<button data-missing="${q}" aria-label="กลับไปตอบข้อ ${q}">${q}</button>`).join('');
  $('submit-error').textContent = '';
  $('review-dialog').showModal();
});
$('missing-list').addEventListener('click', e => { const button = e.target.closest('[data-missing]'); if (button) { $('review-dialog').close(); jumpTo(Number(button.dataset.missing)); } });
$('back-to-sheet').addEventListener('click', () => $('review-dialog').close());

$('confirm-submit').addEventListener('click', async () => {
  const id = activeExam;
  const e = exams[id];
  const btn = $('confirm-submit');
  btn.disabled = true; btn.textContent = 'กำลังส่ง…';
  try {
    clearTimeout(e.saveTimer); e.saveTimer = null;
    if (e.inFlight) await e.inFlight;
    const data = await api('submit', { exam: id, answers: e.answers });
    e.dirty = false;
    e.result = data.result;
    e.state = { status: 'submitted', score: data.result.score, startedAt: data.result.startedAt, submittedAt: data.result.submittedAt };
    clearBackup(id);
    $('review-dialog').close();
    render();
    scrollTo({ top: 0 });
    toast('ส่งคำตอบเรียบร้อย ดูผลและคำแนะนำด้านล่างได้เลย');
  } catch (err) {
    if (err.code === 'auth') { $('review-dialog').close(); sessionExpired(); }
    else $('submit-error').textContent = 'ส่งไม่สำเร็จ: ' + err.message + ' — คำตอบยังอยู่ครบ ลองกดส่งอีกครั้ง';
  } finally { btn.disabled = false; btn.textContent = 'ยืนยันส่งคำตอบ'; }
});

$('logout').addEventListener('click', async () => {
  const pending = Object.keys(exams).filter(id => exams[id].dirty || exams[id].inFlight);
  await Promise.all(pending.map(flush));
  logout();
  location.reload();
});
$('try-other').addEventListener('click', () => showLogin());

/* ---------- เริ่มต้น ---------- */

(async function init() {
  if (!getSession()) return showLogin();
  try { applyMe(await api('me')); }
  catch (err) { err.code === 'auth' ? (logout(), showLogin()) : showLogin('เชื่อมต่อระบบไม่สำเร็จ: ' + err.message); }
})();

if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'read_answer_sheet', title: 'อ่านกระดาษคำตอบ', description: 'Read the signed-in student\'s current answers and status for the active exam set.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({ exam: activeExam, title: current().title, status: current().state.status, answers: current().answers.map(a => [...a]) })
    })).catch(() => {});
  } catch (_) { /* ไม่มีผล */ }
}
