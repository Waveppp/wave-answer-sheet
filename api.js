// การเชื่อมต่อหลังบ้าน (Apps Script) และการเข้าสู่ระบบด้วย Google
const cfg = window.WSL_CONFIG || {};
export const isMock = cfg.API_URL === 'mock';
const SESSION_KEY = 'wsl-session';
let mock;

export class ApiError extends Error {
  constructor(code, message, data) { super(message || code); this.code = code; this.data = data || {}; }
}

export function getSession() { try { return localStorage.getItem(SESSION_KEY); } catch (_) { return null; } }
export function setSession(value) {
  try { value ? localStorage.setItem(SESSION_KEY, value) : localStorage.removeItem(SESSION_KEY); } catch (_) { /* ใช้ต่อได้แม้เก็บไม่ได้ */ }
}

export async function api(action, payload = {}) {
  const body = { action, session: getSession(), ...payload };
  let data;
  if (isMock) {
    mock ||= await import('/dev/mock-api.js');
    data = await mock.handle(JSON.parse(JSON.stringify(body)));
  } else {
    let res;
    try {
      // text/plain ทำให้ไม่มี CORS preflight ซึ่ง Apps Script ไม่รองรับ
      res = await fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
    } catch (_) { throw new ApiError('network', 'เชื่อมต่ออินเทอร์เน็ตไม่ได้'); }
    if (!res.ok) throw new ApiError('network', 'เซิร์ฟเวอร์ไม่ตอบสนอง (' + res.status + ')');
    data = await res.json();
  }
  if (!data.ok) throw new ApiError(data.error, data.message, data);
  return data;
}

const DEMO_ACCOUNTS = [
  { email: 'student@demo.test', label: 'นักเรียนทดลอง (ยังไม่เริ่มสอบ)' },
  { email: 'pim@demo.test', label: 'นักเรียนที่ส่งแล้ว (ดูผลสอบ)' },
  { email: 'borewave@gmail.com', label: 'ครูเวฟ (หน้าครู)' },
  { email: 'outsider@demo.test', label: 'อีเมลที่ไม่มีสิทธิ์' }
];

/** แสดงปุ่มเข้าสู่ระบบใน el; เรียก onLogin(data) เมื่อผ่าน, onDenied(email) เมื่ออีเมลไม่มีสิทธิ์ */
export function mountLogin(el, { onLogin, onDenied, onError }) {
  const exchange = async idToken => {
    try {
      const data = await api('login', { idToken });
      setSession(data.session);
      onLogin(data);
    } catch (err) {
      if (err.code === 'not_allowed') onDenied(err.data.email);
      else onError(err.code === 'auth' ? 'ยืนยันตัวตนกับ Google ไม่สำเร็จ ลองใหม่อีกครั้ง' : err.message);
    }
  };
  if (isMock) {
    el.innerHTML = `<p class="mock-note">โหมดทดลองในเครื่อง — เลือกบัญชีตัวอย่าง</p>` +
      DEMO_ACCOUNTS.map(a => `<button class="demo-account" data-email="${a.email}"><strong>${a.label}</strong><small>${a.email}</small></button>`).join('');
    el.onclick = e => { const b = e.target.closest('[data-email]'); if (b) exchange('mock:' + b.dataset.email); };
    return;
  }
  if (!cfg.GOOGLE_CLIENT_ID) { onError('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID ใน config.js'); return; }
  const render = () => {
    google.accounts.id.initialize({ client_id: cfg.GOOGLE_CLIENT_ID, callback: r => exchange(r.credential), ux_mode: 'popup' });
    el.innerHTML = '';
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'th', width: 280 });
  };
  if (window.google?.accounts?.id) return render();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = render;
  s.onerror = () => onError('โหลดปุ่ม Google ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต');
  document.head.appendChild(s);
}

export function logout() {
  setSession(null);
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch (_) { /* ไม่มีผล */ }
}
