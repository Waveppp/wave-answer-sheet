// ฟังก์ชันล้วนของกระดาษคำตอบ (ทดสอบด้วย Node ได้)
export const QUESTIONS = 40;
export const CHOICES = 5;

export const emptyAnswers = () => Array.from({ length: QUESTIONS }, () => []);

/** แตะวงที่ยังไม่ฝน = เพิ่ม, แตะวงที่ฝนแล้ว = ลบเฉพาะวงนั้น (toggle=false คือเพิ่มอย่างเดียว) */
export function toggleChoice(previous, choice, toggle = true) {
  if (!Number.isInteger(choice) || choice < 1 || choice > CHOICES) throw new Error('คำตอบไม่ถูกต้อง');
  const erasing = toggle && previous.includes(choice);
  const next = erasing ? previous.filter(v => v !== choice) : [...new Set([...previous, choice])].sort((a, b) => a - b);
  return { next, erasing };
}

export const countAnswered = answers => answers.filter(a => a.length > 0).length;

export function sameAnswers(a, b) {
  return a.length === b.length && a.every((x, i) => x.length === b[i].length && x.every((v, j) => v === b[i][j]));
}

/** เวลาที่เหลือ (ms) ติดลบเมื่อเกินเวลาแนะนำ */
export const remainingMs = (startedAt, minutes, now) => startedAt + minutes * 60000 - now;

export function formatClock(ms) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const body = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
  return (ms < 0 ? '+' : '') + body;
}
