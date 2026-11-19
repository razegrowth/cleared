export interface SnoozeOption {
  key: string;
  label: string;
  when: string;
  at: number;
}

function at(day: Date, hours: number, minutes = 0): Date {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + fmtTime(d);

/** The usual snooze choices, skipping any that would land in the past or too soon to matter. */
export function snoozeOptions(now = new Date()): SnoozeOption[] {
  const out: SnoozeOption[] = [];
  const later = new Date(now);
  later.setHours(now.getHours() + 3, 0, 0, 0);
  if (now.getHours() >= 6 && later.getDate() === now.getDate() && later.getHours() < 21) {
    out.push({ key: '1', label: 'Later today', when: fmtTime(later), at: later.getTime() });
  }
  const evening = at(now, 18);
  if (evening.getTime() - now.getTime() > 60 * 60_000) {
    out.push({ key: String(out.length + 1), label: 'This evening', when: fmtTime(evening), at: evening.getTime() });
  }
  if (now.getHours() < 6) {
    const morning = at(now, 8);
    out.push({ key: String(out.length + 1), label: 'This morning', when: fmtTime(morning), at: morning.getTime() });
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tm = at(tomorrow, 8);
  out.push({ key: String(out.length + 1), label: 'Tomorrow', when: fmtDay(tm), at: tm.getTime() });

  const day = now.getDay(); // 0 Sun … 6 Sat
  if (day >= 1 && day <= 4) {
    const sat = new Date(now);
    sat.setDate(now.getDate() + (6 - day));
    const s = at(sat, 9);
    out.push({ key: String(out.length + 1), label: 'This weekend', when: fmtDay(s), at: s.getTime() });
  }
  const mon = new Date(now);
  mon.setDate(now.getDate() + (((8 - day) % 7) || 7));
  const m = at(mon, 8);
  out.push({ key: String(out.length + 1), label: 'Next week', when: fmtDay(m), at: m.getTime() });
  return out;
}

export function describeSnooze(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? fmtTime(d) : fmtDay(d);
}
