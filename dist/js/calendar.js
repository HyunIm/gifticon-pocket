// Expiry reminders as a calendar file (.ics): each usable
// coupon becomes an all-day event on its expiry date with alarms at 9:00 three days before and
// on the day. Importing again updates the same events (stable UIDs). Pure functions, no DOM.
import { statusOf, isUsable, localDay } from './coupon.js';

const escape = text => String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

// RFC 5545: lines longer than 75 octets continue on the next line after a space.
function fold(line) {
  const bytes = new TextEncoder();
  const out = [];
  let current = '';
  for (const char of line) {
    if (bytes.encode(current + char).length > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
    }
    current += char;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compactDate = value => value.replaceAll('-', '');
const nextDay = value => {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  return date.toISOString().slice(0, 10).replaceAll('-', '');
};
const stamp = now => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function buildCalendar(records, now = new Date()) {
  const today = localDay(now);
  const events = records
    .filter(record => isUsable(statusOf(record, today)))
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .flatMap(record => {
      const title = record.name.startsWith(record.brand) ? record.name : `${record.brand} ${record.name}`;
      const details = [record.code && `쿠폰 번호: ${record.code}`, record.balance != null && `잔액: ${record.balance.toLocaleString('ko-KR')}원`, record.memo]
        .filter(Boolean).join('\n');
      const alarm = (trigger, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
      return [
        'BEGIN:VEVENT',
        `UID:${record.id}@gifticon-pocket`,
        `DTSTAMP:${stamp(now)}`,
        `DTSTART;VALUE=DATE:${compactDate(record.expiry)}`,
        `DTEND;VALUE=DATE:${nextDay(record.expiry)}`,
        `SUMMARY:${escape(`기프티콘 만료: ${title}`)}`,
        ...(details ? [`DESCRIPTION:${escape(details)}`] : []),
        'TRANSP:TRANSPARENT',
        // All-day events start at 00:00: 9:00 three days before, and 9:00 on the day.
        ...alarm('-P2DT15H', `3일 후 만료: ${title}`),
        ...alarm('PT9H', `오늘 만료: ${title}`),
        'END:VEVENT',
      ];
    });
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//gifticon-pocket//ko', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:기프티콘 만료', ...events, 'END:VCALENDAR'];
  return { text: lines.map(fold).join('\r\n') + '\r\n', count: events.filter(line => line === 'BEGIN:VEVENT').length };
}
