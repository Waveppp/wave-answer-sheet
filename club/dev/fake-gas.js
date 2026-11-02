// โหมดทดลองในเครื่อง: จำลอง Google Sheet + Apps Script เพื่อรัน Code.gs ตัวจริงโดยไม่ต้องติดตั้ง
// ใช้เฉพาะตอนเปิด Index.html นอก Apps Script (บน Apps Script จริงไฟล์นี้ไม่ถูกโหลด)
(function (root) {
  function makeFakeGas(store) {
    const db = store.load() || {};
    const save = () => store.save(db);

    function grid(name) { return db[name] || (db[name] = []); }

    function makeRange(name, r, c, nr, nc) {
      const range = {
        getValues() {
          const g = grid(name);
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) {
              const v = (g[r - 1 + i] || [])[c - 1 + j];
              row.push(v === undefined || v === null ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        setValues(vals) {
          const g = grid(name);
          vals.forEach((row, i) => row.forEach((v, j) => {
            const rr = r - 1 + i;
            while (g.length <= rr) g.push([]);
            g[rr][c - 1 + j] = v instanceof Date ? v.toISOString() : v;
          }));
          save();
          return range;
        },
        setValue(v) { return range.setValues([[v]]); },
        setFontWeight() { return range; },
        setNumberFormat() { return range; }
      };
      return range;
    }

    function makeSheet(name) {
      const sheet = {
        getName: () => name,
        getLastRow: () => grid(name).length,
        getDataRange() {
          const g = grid(name);
          const cols = Math.max(1, ...g.map(row => row.length));
          return makeRange(name, 1, 1, Math.max(1, g.length), cols);
        },
        getRange(a, b, c, d) {
          if (typeof a === 'string') return makeRange(name, 1, 1, 0, 0); // ช่วงแบบ "A:A" ใช้แค่ตั้งรูปแบบ
          return makeRange(name, a, b, c || 1, d || 1);
        },
        appendRow(row) {
          grid(name).push(row.map(v => (v instanceof Date ? v.toISOString() : v)));
          save();
          return sheet;
        },
        deleteRow(i) { grid(name).splice(i - 1, 1); save(); },
        clear() { db[name] = []; save(); return sheet; },
        setFrozenRows() { return sheet; }
      };
      return sheet;
    }

    const spreadsheet = {
      getSheetByName: name => (db[name] ? makeSheet(name) : null),
      insertSheet(name) { db[name] = []; save(); return makeSheet(name); }
    };

    return {
      db,
      globals: {
        SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush() {}, getUi() { throw new Error('ไม่มีเมนูในโหมดทดลอง'); } },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        HtmlService: {}
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { makeFakeGas }; return; }

  // ----- เบราว์เซอร์ -----
  const KEY = 'club-dev-db';
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } },
    save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) { /* เก็บไม่ได้ก็ใช้ต่อในหน้านี้ */ } }
  };
  const fake = makeFakeGas(store);
  Object.assign(root, fake.globals);

  const ready = fetch('Code.gs').then(r => r.text()).then(src => {
    const s = document.createElement('script');
    s.textContent = src;
    document.head.appendChild(s);
  });

  function runner(onOk, onFail) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return fn => runner(fn, onFail);
        if (prop === 'withFailureHandler') return fn => runner(onOk, fn);
        return (...args) => {
          ready.then(() => new Promise(r => setTimeout(r, 250))).then(() => {
            try {
              const out = root[prop](...JSON.parse(JSON.stringify(args)));
              if (onOk) onOk(JSON.parse(JSON.stringify(out === undefined ? null : out)));
            } catch (e) { if (onFail) onFail(e); }
          });
        };
      }
    });
  }
  root.google = { script: { run: runner(null, null) } };

  // ปุ่มช่วยทดลอง
  root.CLUB_DEV = {
    seedRoster() {
      const first = ['ณัฐ', 'ปภา', 'ธนา', 'กันต์', 'พิม', 'ภูมิ', 'ใบเตย', 'ต้นกล้า', 'มายด์', 'ฟ้า', 'ข้าวหอม', 'ภู', 'อชิ', 'ปัน', 'ไอซ์'];
      const last = ['ใจดี', 'รักเรียน', 'มั่นคง', 'สุขสันต์', 'แสงทอง', 'ศรีสุข', 'บุญมา', 'ทองคำ'];
      const rows = [['ห้อง', 'เลขที่', 'ชื่อ-สกุล']];
      ['ม.1/5', 'ม.1/6', 'ม.1/7', 'ม.1/8'].forEach((room, k) => {
        for (let no = 1; no <= 45; no++) {
          const boy = no <= 22;
          rows.push([room, no, `${boy ? 'ด.ช.' : 'ด.ญ.'}${first[(no + k * 3) % first.length]} ${last[(no * 7 + k) % last.length]}`]);
        }
      });
      fake.db['รายชื่อนักเรียน'] = rows;
      store.save(fake.db);
      location.reload();
    },
    clearRoster() { fake.db['รายชื่อนักเรียน'] = [['ห้อง', 'เลขที่', 'ชื่อ-สกุล']]; store.save(fake.db); location.reload(); },
    reset() { try { localStorage.removeItem(KEY); } catch (_) { /* ไม่มีผล */ } location.reload(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
