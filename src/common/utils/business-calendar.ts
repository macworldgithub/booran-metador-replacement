import type { RooftopEntity } from '../../modules/database/entities';

const zone = 'Australia/Melbourne';
export function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (name: string) =>
    Number(parts.find((part) => part.type === name)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}
export function melbourneDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let result = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(result));
    const observed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    result += target - observed;
  }
  return new Date(result);
}
export function isOpen(rooftop: RooftopEntity, at = new Date()): boolean {
  const p = localParts(at);
  const weekday = new Intl.DateTimeFormat('en-AU', {
    timeZone: zone,
    weekday: 'long',
  }).format(at);
  const mins = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return (
    !rooftop.closedDays.includes(weekday) &&
    p.hour * 60 + p.minute >= mins(rooftop.sendHours.start) &&
    p.hour * 60 + p.minute < mins(rooftop.sendHours.end)
  );
}
export function nextOpen(rooftop: RooftopEntity, at = new Date()): Date {
  if (isOpen(rooftop, at)) return at;
  let p = localParts(at);
  const [hour, minute] = rooftop.sendHours.start.split(':').map(Number);
  for (let i = 0; i < 370; i++) {
    const candidate = melbourneDate(p.year, p.month, p.day, hour, minute);
    if (candidate >= at && isOpen(rooftop, candidate)) return candidate;
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    p = {
      ...p,
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
    };
  }
  throw new Error('No open dealership day in the next year');
}
export function businessHours(
  rooftop: RooftopEntity,
  hours: number,
  at = new Date(),
): Date {
  let cursor = nextOpen(rooftop, at);
  let remaining = Math.round(hours * 60);
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 60000);
    remaining--;
    if (!isOpen(rooftop, cursor)) cursor = nextOpen(rooftop, cursor);
  }
  return cursor;
}
export function nextMorning(rooftop: RooftopEntity, at = new Date()): Date {
  const p = localParts(at);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return nextOpen(
    rooftop,
    melbourneDate(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      0,
    ),
  );
}
export function calendarDays(
  rooftop: RooftopEntity,
  days: number,
  anchor: Date,
): Date {
  const p = localParts(anchor);
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return nextOpen(
    rooftop,
    melbourneDate(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      target.getUTCDate(),
      p.hour,
      p.minute,
    ),
  );
}
