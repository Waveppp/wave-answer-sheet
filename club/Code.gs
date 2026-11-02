/**
 * ระบบจัดชมรม ม.1 — หลังบ้าน (Google Apps Script ผูกกับ Google Sheet)
 * วิธีติดตั้งทีละขั้นอยู่ในไฟล์ SETUP.md
 *
 * ข้อมูลทั้งหมดเก็บใน Google Sheet 3 แท็บ (สร้างให้อัตโนมัติ)
 *   ชมรม            — ชื่อชมรม ครูที่ปรึกษา และจำนวนที่รับได้ (10 แถว)
 *   สมาชิกชมรม      — นักเรียนที่ครูกรอกเข้าชมรม (ห้อง/เลขที่/ชื่อ/ชมรม)
 *   รายชื่อนักเรียน  — รายชื่อจากห้องเรียน (เว้นว่างได้ ถ้ามีครูจะแตะเลือกชื่อได้เลย)
 */

// ===== ตั้งค่า (แก้ได้) =====
const CONFIG = {
  ROOMS: ['ม.1/5', 'ม.1/6', 'ม.1/7', 'ม.1/8'],
  CLUB_COUNT: 10,
  DEFAULT_CAPACITY: 20,   // ชมรมละกี่คน (แก้ภายหลังได้จากหน้า "ผู้ดูแลระบบ")
  MAX_NUMBER: 60,         // เลขที่สูงสุดที่ยอมให้กรอก
  ADMIN_PIN: '2569'       // รหัสเข้าหน้า "ผู้ดูแลระบบ" — เปลี่ยนก่อนใช้งานจริง
};

const SHEETS = { clubs: 'ชมรม', members: 'สมาชิกชมรม', roster: 'รายชื่อนักเรียน' };
const HEADERS = {
  clubs: ['ชมรมที่', 'ชื่อชมรม', 'ครูที่ปรึกษา', 'รับได้ (คน)'],
  members: ['ห้อง', 'เลขที่', 'ชื่อ-สกุล', 'ชมรมที่', 'ชื่อชมรม', 'บันทึกเมื่อ'],
  roster: ['ห้อง', 'เลขที่', 'ชื่อ-สกุล']
};

// ===== หน้าเว็บ และเมนูใน Google Sheet =====

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบจัดชมรม ม.1')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบชมรม')
    .addItem('เตรียมแท็บข้อมูล', 'setup')
    .addItem('สร้างแท็บสรุปรายห้อง (สำหรับพิมพ์)', 'buildRoomSheets')
    .addToUi();
}

/** สร้างแท็บที่ยังไม่มี (กดจากเมนู "ระบบชมรม" ได้ หรือระบบเรียกเองตอนใช้งานครั้งแรก) */
function setup() {
  Object.keys(SHEETS).forEach(sheet_);
  readClubs_();
}

// ===== ฟังก์ชันที่หน้าเว็บเรียก =====

function getState() {
  return safe_(() => ({ ok: true, state: state_() }));
}

function saveClub(clubId, name, teacher) {
  return withLock_(() => {
    const id = Number(clubId);
    name = clean_(name, 60);
    teacher = clean_(teacher, 60);
    if (!name) return fail_('กรุณาพิมพ์ชื่อชมรม');
    const clubs = readClubs_();
    const club = clubs.find(c => c.id === id);
    if (!club) return fail_('ไม่พบชมรมนี้');
    const dup = clubs.find(c => c.id !== id && c.name && same_(c.name, name));
    if (dup) return fail_(`มีชมรมชื่อ "${dup.name}" แล้ว (ชมรมที่ ${dup.id}) กรุณาใช้ชื่ออื่น`);

    sheet_('clubs').getRange(club.row, 2, 1, 2).setValues([[name, teacher]]);
    // อัปเดตชื่อชมรมในแท็บสมาชิกให้ตรงกัน
    const sh = sheet_('members');
    readMembers_().forEach(m => { if (m.clubId === id) sh.getRange(m.row, 5).setValue(name); });
    return done_(`บันทึกชื่อชมรม "${name}" แล้ว`);
  });
}

function addMember(clubId, room, number, name) {
  return withLock_(() => {
    const id = Number(clubId);
    room = normRoom_(room);
    const no = Number(number);
    if (CONFIG.ROOMS.indexOf(room) < 0) return fail_('กรุณาเลือกห้อง');
    if (!Number.isInteger(no) || no < 1 || no > CONFIG.MAX_NUMBER) return fail_(`เลขที่ต้องเป็นตัวเลข 1–${CONFIG.MAX_NUMBER}`);

    const club = readClubs_().find(c => c.id === id);
    if (!club) return fail_('ไม่พบชมรมนี้');
    if (!club.name) return fail_('กรุณาตั้งชื่อชมรมก่อน');

    const fromRoster = readRoster_().find(s => s.room === room && s.no === no);
    name = fromRoster ? fromRoster.name : clean_(name, 80);
    if (!name) return fail_('กรุณาพิมพ์ชื่อ-สกุลนักเรียน');

    const members = readMembers_();
    const taken = members.find(m => m.room === room && m.no === no);
    if (taken) {
      if (taken.clubId === id) return fail_(`${room} เลขที่ ${no} (${taken.name}) อยู่ในชมรมนี้แล้ว`);
      const other = readClubs_().find(c => c.id === taken.clubId);
      return fail_(`${room} เลขที่ ${no} (${taken.name}) อยู่ชมรม "${other ? other.name : taken.clubId}" แล้ว ` +
        'ถ้าจะย้ายมาชมรมนี้ ให้ครูชมรมนั้นลบชื่อออกก่อน');
    }
    const count = members.filter(m => m.clubId === id).length;
    if (count >= club.capacity) return fail_(`ชมรมเต็มแล้ว (${count}/${club.capacity} คน)`);

    sheet_('members').appendRow([room, no, name, id, club.name, new Date()]);
    return done_(`เพิ่ม ${name} (${room} เลขที่ ${no}) แล้ว`);
  });
}

function removeMember(clubId, room, number) {
  return withLock_(() => {
    const id = Number(clubId);
    room = normRoom_(room);
    const no = Number(number);
    const m = readMembers_().find(x => x.clubId === id && x.room === room && x.no === no);
    if (!m) return done_('รายชื่อนี้ถูกลบไปแล้ว');
    sheet_('members').deleteRow(m.row);
    return done_(`ลบ ${m.name} ออกจากชมรมแล้ว`);
  });
}

// ----- ผู้ดูแลระบบ -----

function adminCheck(pin) {
  return safe_(() => String(pin) === String(CONFIG.ADMIN_PIN) ? { ok: true } : fail_('รหัสไม่ถูกต้อง'));
}

function adminSetCapacity(pin, capacity) {
  return withLock_(() => {
    if (String(pin) !== String(CONFIG.ADMIN_PIN)) return fail_('รหัสไม่ถูกต้อง');
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 200) return fail_('จำนวนต้องเป็นตัวเลข 1–200');
    const clubs = readClubs_();
    const over = clubs.filter(c => c.count > cap);
    const sh = sheet_('clubs');
    clubs.forEach(c => sh.getRange(c.row, 4).setValue(cap));
    const note = over.length ? ` (มี ${over.length} ชมรมที่สมาชิกเกินอยู่แล้ว ระบบจะไม่รับเพิ่มจนกว่าจะลดลง)` : '';
    return done_(`ตั้งให้ทุกชมรมรับได้ ${cap} คนแล้ว${note}`);
  });
}

function adminResetClub(pin, clubId) {
  return withLock_(() => {
    if (String(pin) !== String(CONFIG.ADMIN_PIN)) return fail_('รหัสไม่ถูกต้อง');
    const id = Number(clubId);
    const club = readClubs_().find(c => c.id === id);
    if (!club) return fail_('ไม่พบชมรมนี้');
    const sh = sheet_('members');
    readMembers_().filter(m => m.clubId === id).map(m => m.row).sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
    sheet_('clubs').getRange(club.row, 2, 1, 2).setValues([['', '']]);
    return done_(`ล้างชมรมที่ ${id} แล้ว (ลบชื่อชมรมและรายชื่อสมาชิกทั้งหมด)`);
  });
}

// ===== สร้างแท็บสรุปรายห้องใน Google Sheet (เมนู ระบบชมรม) =====

function buildRoomSheets() {
  const st = state_();
  const clubName = {};
  const clubTeacher = {};
  st.clubs.forEach(c => { clubName[c.id] = c.name; clubTeacher[c.id] = c.teacher; });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  st.rooms.forEach(room => {
    const title = 'สรุป ' + room.replace('/', '-');
    const sh = ss.getSheetByName(title) || ss.insertSheet(title);
    sh.clear();
    const rows = roomRows_(st, room).map(r => [r.no, r.name, r.clubId ? clubName[r.clubId] : 'ยังไม่มีชมรม', r.clubId ? clubTeacher[r.clubId] : '']);
    const out = [['เลขที่', 'ชื่อ-สกุล', 'ชมรม', 'ครูที่ปรึกษา']].concat(rows);
    sh.getRange(1, 1, out.length, 4).setValues(out);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
}

// ===== ภายใน =====

function state_() {
  const clubs = readClubs_();
  const members = readMembers_().map(m => ({ room: m.room, no: m.no, name: m.name, clubId: m.clubId }));
  const roster = readRoster_();
  return {
    rooms: CONFIG.ROOMS,
    clubCount: CONFIG.CLUB_COUNT,
    maxNumber: CONFIG.MAX_NUMBER,
    clubs: clubs.map(c => ({ id: c.id, name: c.name, teacher: c.teacher, capacity: c.capacity, count: c.count })),
    members: members,
    roster: roster
  };
}

/** รายชื่อของห้อง: ใช้รายชื่อนักเรียนเป็นหลัก แล้วเติมคนที่ครูพิมพ์เองแต่ไม่อยู่ในรายชื่อ */
function roomRows_(st, room) {
  const byNo = {};
  st.roster.filter(s => s.room === room).forEach(s => { byNo[s.no] = { no: s.no, name: s.name, clubId: null }; });
  st.members.filter(m => m.room === room).forEach(m => { byNo[m.no] = { no: m.no, name: m.name, clubId: m.clubId }; });
  return Object.keys(byNo).map(k => byNo[k]).sort((a, b) => a.no - b.no);
}

function sheet_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEETS[key]);
  if (sh) return sh;
  sh = ss.insertSheet(SHEETS[key]);
  sh.getRange(1, 1, 1, HEADERS[key].length).setValues([HEADERS[key]]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (key !== 'clubs') sh.getRange('A:A').setNumberFormat('@'); // กัน "1/5" กลายเป็นวันที่
  return sh;
}

function rows_(key) {
  return sheet_(key).getDataRange().getValues().slice(1);
}

function readClubs_() {
  const sh = sheet_('clubs');
  const counts = {};
  readMembers_().forEach(m => { counts[m.clubId] = (counts[m.clubId] || 0) + 1; });
  const clubs = [];
  rows_('clubs').forEach((r, i) => {
    const id = Number(r[0]);
    if (!id || clubs.some(c => c.id === id)) return;
    const cap = Number(r[3]);
    clubs.push({
      row: i + 2, id: id, name: String(r[1]).trim(), teacher: String(r[2]).trim(),
      capacity: cap > 0 ? cap : CONFIG.DEFAULT_CAPACITY, count: counts[id] || 0
    });
  });
  // เติมชมรมที่ยังไม่มีแถวให้ครบ
  for (let id = 1; id <= CONFIG.CLUB_COUNT; id++) {
    if (clubs.some(c => c.id === id)) continue;
    sh.appendRow([id, '', '', CONFIG.DEFAULT_CAPACITY]);
    clubs.push({ row: sh.getLastRow(), id: id, name: '', teacher: '', capacity: CONFIG.DEFAULT_CAPACITY, count: counts[id] || 0 });
  }
  return clubs.filter(c => c.id <= CONFIG.CLUB_COUNT).sort((a, b) => a.id - b.id);
}

function readMembers_() {
  const out = [];
  rows_('members').forEach((r, i) => {
    const room = normRoom_(r[0]);
    const no = Number(r[1]);
    if (!room || !no) return;
    out.push({ row: i + 2, room: room, no: no, name: String(r[2]).trim(), clubId: Number(r[3]) });
  });
  return out;
}

function readRoster_() {
  const seen = {};
  const out = [];
  rows_('roster').forEach(r => {
    const room = normRoom_(r[0]);
    const no = Number(r[1]);
    const name = String(r[2]).trim();
    if (CONFIG.ROOMS.indexOf(room) < 0 || !no || !name || seen[room + '#' + no]) return;
    seen[room + '#' + no] = true;
    out.push({ room: room, no: no, name: name });
  });
  return out.sort((a, b) => a.room.localeCompare(b.room) || a.no - b.no);
}

/** รับ "ม.1/5", "1/5", "5" หรือวันที่ที่ชีตแปลงเอง แล้วคืน "ม.1/5" */
function normRoom_(v) {
  if (v instanceof Date) {
    const d = v.getDate();
    const m = v.getMonth() + 1;
    const n = d === 1 ? m : (m === 1 ? d : 0);
    return n ? 'ม.1/' + n : '';
  }
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/(\d+)\s*$/);
  return m ? 'ม.1/' + Number(m[1]) : s;
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function same_(a, b) {
  return clean_(a, 200).toLowerCase() === clean_(b, 200).toLowerCase();
}

function fail_(message) {
  return { ok: false, message: message };
}

function done_(message) {
  return { ok: true, message: message, state: state_() };
}

function safe_(fn) {
  try { return fn(); } catch (e) { return { ok: false, message: 'เกิดข้อผิดพลาด: ' + (e && e.message ? e.message : e) }; }
}

function withLock_(fn) {
  return safe_(() => {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const out = fn();
      SpreadsheetApp.flush();
      if (!out.ok) out.state = state_();
      return out;
    } finally {
      lock.releaseLock();
    }
  });
}
