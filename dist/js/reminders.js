// Expiry reminders: one notification at 9:00 three days before and on the expiry day.
// Coupons reminded at the same moment share one notification. Pure functions, no DOM.
export const REMIND_DAYS_BEFORE = [3, 0];
export const REMIND_HOUR = 9;
const MAX_REMINDERS = 100;

const label = record => [record.brand, record.name].filter(Boolean).join(' ');

function describe(items) {
  const today = items.filter(item => item.daysBefore === 0);
  const later = items.filter(item => item.daysBefore > 0);
  const title = today.length && later.length ? '곧 만료되는 기프티콘이 있어요'
    : today.length ? `오늘 만료되는 기프티콘 ${today.length}개`
      : `${later[0].daysBefore}일 후 만료되는 기프티콘 ${later.length}개`;
  const ordered = [...today, ...later];
  const names = ordered.slice(0, 2).map(item => {
    const prefix = today.length && later.length ? (item.daysBefore === 0 ? '오늘: ' : `${item.daysBefore}일 후: `) : '';
    return prefix + label(item.record);
  });
  const rest = ordered.length - names.length;
  return { title, body: names.join('\n') + (rest > 0 ? `\n외 ${rest}개` : '') };
}

// records: coupons from the database. Returns [{ at, title, body, tag, url }] sorted by time.
export function buildReminders(records, now = Date.now()) {
  const slots = new Map();
  for (const record of records) {
    if (record.used || !/^\d{4}-\d{2}-\d{2}$/.test(record.expiry || '')) continue;
    const [y, m, d] = record.expiry.split('-').map(Number);
    for (const daysBefore of REMIND_DAYS_BEFORE) {
      // Local time: 9:00 where the phone is, also across daylight saving changes.
      const at = new Date(y, m - 1, d - daysBefore, REMIND_HOUR).getTime();
      if (at <= now) continue;
      if (!slots.has(at)) slots.set(at, []);
      slots.get(at).push({ record, daysBefore });
    }
  }
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_REMINDERS)
    .map(([at, items]) => {
      items.sort((a, b) => a.daysBefore - b.daysBefore || label(a.record).localeCompare(label(b.record), 'ko'));
      const day = new Date(at);
      const tag = `expiry-${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
      return { at, ...describe(items), tag, url: '/?filter=expiring' };
    });
}
