// ทดสอบ Code.gs กับชีตจำลอง: node club/dev/test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { makeFakeGas } = require('./fake-gas.js');

function boot(seed) {
  let db = seed ? structuredClone(seed) : null;
  const fake = makeFakeGas({ load: () => db, save: d => { db = d; } });
  const ctx = vm.createContext({ ...fake.globals, Date, console });
  vm.runInContext(fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8'), ctx);
  // ส่งผ่าน JSON เหมือน google.script.run (และแก้ปัญหา array ข้าม vm)
  const api = new Proxy({}, { get: (_, k) => (...a) => { const out = ctx[k](...a); return out === undefined ? out : JSON.parse(JSON.stringify(out)); } });
  return { ctx: api, raw: ctx, db: fake.db };
}

let { ctx, raw, db } = boot();
let r = ctx.getState();
assert.equal(r.ok, true);
assert.equal(r.state.clubs.length, 10);
assert.equal(r.state.clubs[0].capacity, 20);
assert.deepEqual(r.state.rooms, ['ม.1/5', 'ม.1/6', 'ม.1/7', 'ม.1/8']);

assert.equal(ctx.addMember(1, 'ม.1/5', 1, 'ก').ok, false, 'ต้องตั้งชื่อชมรมก่อน');
assert.equal(ctx.saveClub(1, '  ดนตรี  ', 'ครูเอ').ok, true);
assert.equal(ctx.saveClub(2, 'ดนตรี', '').ok, false, 'ชื่อซ้ำ');
assert.equal(ctx.saveClub(2, 'กีฬา', 'ครูบี').ok, true);

r = ctx.addMember(1, 'ม.1/5', '3', 'ด.ช.หนึ่ง');
assert.equal(r.ok, true, r.message);
assert.equal(r.state.clubs[0].count, 1);
assert.equal(ctx.addMember(2, '1/5', 3, 'x').ok, false, 'ซ้ำข้ามชมรม (รับ "1/5")');
assert.match(ctx.addMember(2, 'ม.1/5', 3, 'x').message, /ดนตรี/);
assert.equal(ctx.addMember(1, 'ม.1/9', 1, 'x').ok, false, 'ห้องไม่อยู่ในรายการ');
assert.equal(ctx.addMember(1, 'ม.1/6', 0, 'x').ok, false);
assert.equal(ctx.addMember(1, 'ม.1/6', 2, '   ').ok, false, 'ไม่มีชื่อ');

// เต็ม
for (let i = 1; i <= 19; i++) assert.equal(ctx.addMember(1, 'ม.1/6', i, 'คน ' + i).ok, true);
r = ctx.addMember(1, 'ม.1/7', 1, 'เกิน');
assert.equal(r.ok, false);
assert.match(r.message, /เต็ม/);
assert.ok(r.state, 'ส่ง state กลับมาด้วยแม้ไม่สำเร็จ');

// ลบ แล้วเพิ่มได้
assert.equal(ctx.removeMember(1, 'ม.1/6', 5).ok, true);
assert.equal(ctx.addMember(1, 'ม.1/7', 1, 'เข้าได้').ok, true);

// เปลี่ยนชื่อชมรม -> แท็บสมาชิกเปลี่ยนตาม
ctx.saveClub(1, 'ดนตรีสากล', 'ครูเอ');
assert.ok(db['สมาชิกชมรม'].slice(1).filter(x => x[3] === 1).every(x => x[4] === 'ดนตรีสากล'));

// รายชื่อนักเรียน: ชื่อจากรายชื่อมาก่อนชื่อที่พิมพ์, รับห้องที่ชีตแปลงเป็นวันที่
db['รายชื่อนักเรียน'].push(['ม.1/8', 4, 'ด.ญ.จากรายชื่อ'], ['1/8', 5, 'ด.ช.ห้า'], ['ม.1/3', 1, 'ห้องอื่น']);
r = ctx.addMember(2, 'ม.1/8', 4, 'พิมพ์ผิด');
assert.equal(r.ok, true);
assert.ok(r.state.members.some(m => m.name === 'ด.ญ.จากรายชื่อ'));
assert.equal(r.state.roster.length, 2, 'ไม่เอาห้องนอกรายการ');
assert.equal(raw.normRoom_(new Date(2026, 4, 1)), 'ม.1/5', '1/5 แบบวัน/เดือน');
assert.equal(raw.normRoom_(new Date(2026, 0, 6)), 'ม.1/6', '1/6 แบบเดือน/วัน');

// ผู้ดูแล
assert.equal(ctx.adminCheck('0000').ok, false);
assert.equal(ctx.adminCheck('2569').ok, true);
assert.equal(ctx.adminSetCapacity('0000', 5).ok, false);
r = ctx.adminSetCapacity('2569', 18);
assert.equal(r.ok, true);
assert.ok(r.state.clubs.every(c => c.capacity === 18));
r = ctx.adminResetClub('2569', 1);
assert.equal(r.ok, true);
assert.equal(r.state.clubs[0].name, '');
assert.equal(r.state.clubs[0].count, 0);
assert.equal(r.state.members.length, 1);

// แถวชมรมถูกลบในชีต -> เติมกลับ
db['ชมรม'].splice(3, 2);
assert.equal(boot(db).ctx.getState().state.clubs.length, 10);

// แท็บสรุปรายห้อง
raw.buildRoomSheets();
assert.deepEqual(db['สรุป ม.1-8'][1], [4, 'ด.ญ.จากรายชื่อ', 'กีฬา', 'ครูบี']);
assert.deepEqual(db['สรุป ม.1-8'][2], [5, 'ด.ช.ห้า', 'ยังไม่มีชมรม', '']);
console.log('ผ่านทุกข้อ ✓');
