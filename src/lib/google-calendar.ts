import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { toRFC3339, addMinutesToDate } from './date-parser.js';

export interface BusinessHoursRule {
  days: number[]; // 0=Sunday, 1=Monday, etc.
  start: string;  // "09:00"
  end: string;    // "17:00"
}

export interface BusinessHours {
  rules: BusinessHoursRule[];
}

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
  accessRole: string;
}

/**
 * List all calendars the user has access to
 */
export async function listCalendars(auth: OAuth2Client): Promise<CalendarInfo[]> {
  const calendar = google.calendar({ version: 'v3', auth });

  const response = await calendar.calendarList.list();
  const calendars = response.data.items || [];

  return calendars.map(cal => ({
    id: cal.id || '',
    name: cal.summary || 'Unnamed Calendar',
    primary: cal.primary || false,
    accessRole: cal.accessRole || 'reader',
  }));
}

export interface TimeSlot {
  start: Date;
  end: Date;
  startRFC3339: string;
  endRFC3339: string;
}

export interface AvailabilityResult {
  available: boolean;
  requestedSlot?: TimeSlot;
  busyPeriods: Array<{ start: string; end: string }>;
  alternatives: TimeSlot[];
}

/**
 * Check availability for a specific time slot
 */
export async function checkSlotAvailability(
  auth: OAuth2Client,
  calendarId: string,
  startTime: Date,
  durationMinutes: number,
  timezone: string,
  businessHours?: BusinessHours
): Promise<AvailabilityResult> {
  const calendar = google.calendar({ version: 'v3', auth });

  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  // Query a wider window to find alternatives (check 3 days)
  const queryStart = new Date(startTime);
  queryStart.setHours(0, 0, 0, 0);

  const queryEnd = new Date(startTime);
  queryEnd.setDate(queryEnd.getDate() + 3);
  queryEnd.setHours(23, 59, 59, 999);

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: queryStart.toISOString(),
      timeMax: queryEnd.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });

  const busyPeriods = response.data.calendars?.[calendarId]?.busy || [];

  // Check if requested slot is available
  const requestedSlot: TimeSlot = {
    start: startTime,
    end: endTime,
    startRFC3339: toRFC3339(startTime, timezone),
    endRFC3339: toRFC3339(endTime, timezone),
  };

  const isAvailable = !isSlotBusy(startTime, endTime, busyPeriods);

  // Find alternative slots if not available
  const alternatives = isAvailable
    ? []
    : findAlternativeSlots(startTime, durationMinutes, busyPeriods, timezone, 3, businessHours);

  return {
    available: isAvailable,
    requestedSlot,
    busyPeriods: busyPeriods.map(b => ({
      start: b.start || '',
      end: b.end || '',
    })),
    alternatives,
  };
}

/**
 * Find available slots within a time range (for "after 4pm" or "morning" requests)
 */
export async function findAvailableSlotsInRange(
  auth: OAuth2Client,
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
  durationMinutes: number,
  timezone: string,
  maxSlots: number = 3,
  businessHours?: BusinessHours
): Promise<TimeSlot[]> {
  const calendar = google.calendar({ version: 'v3', auth });

  // Extend query to include a few days for alternatives
  const queryEnd = new Date(rangeStart);
  queryEnd.setDate(queryEnd.getDate() + 3);
  queryEnd.setHours(23, 59, 59, 999);

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: rangeStart.toISOString(),
      timeMax: queryEnd.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });

  const busyPeriods = response.data.calendars?.[calendarId]?.busy || [];

  return findAlternativeSlots(rangeStart, durationMinutes, busyPeriods, timezone, maxSlots, businessHours);
}

/**
 * Check if a slot overlaps with any busy period
 */
function isSlotBusy(
  slotStart: Date,
  slotEnd: Date,
  busyPeriods: Array<{ start?: string | null; end?: string | null }>
): boolean {
  for (const busy of busyPeriods) {
    if (!busy.start || !busy.end) continue;

    const busyStart = new Date(busy.start);
    const busyEnd = new Date(busy.end);

    // Check for overlap
    if (slotStart < busyEnd && slotEnd > busyStart) {
      return true;
    }
  }
  return false;
}

/**
 * Get the time components in a specific timezone
 */
function getTimeInTimezone(date: Date, timezone: string): { hour: number; minute: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';

  const weekdayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 1;

  return { hour, minute, dayOfWeek };
}

/**
 * Check if a time falls within business hours
 */
function isWithinBusinessHours(
  date: Date,
  timezone: string,
  businessHours?: BusinessHours
): { within: boolean; nextStart?: { hour: number; minute: number }; nextDay?: boolean } {
  // Default business hours: Mon-Fri 9am-5pm
  const defaultRules: BusinessHoursRule[] = [
    { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }
  ];

  const rules = businessHours?.rules || defaultRules;
  const { hour, minute, dayOfWeek } = getTimeInTimezone(date, timezone);
  const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

  // Find a rule that applies to this day
  for (const rule of rules) {
    if (rule.days.includes(dayOfWeek)) {
      if (currentTime >= rule.start && currentTime < rule.end) {
        return { within: true };
      }
      // If before start time on a valid day, return next start
      if (currentTime < rule.start) {
        const [startHour, startMinute] = rule.start.split(':').map(Number);
        return { within: false, nextStart: { hour: startHour!, minute: startMinute! } };
      }
    }
  }

  // Not within any rule, find the next valid day
  // Look ahead up to 7 days to find next business day
  for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
    const nextDay = (dayOfWeek + daysAhead) % 7;
    for (const rule of rules) {
      if (rule.days.includes(nextDay)) {
        const [startHour, startMinute] = rule.start.split(':').map(Number);
        return { within: false, nextStart: { hour: startHour!, minute: startMinute! }, nextDay: true };
      }
    }
  }

  // Fallback to default 9am next day
  return { within: false, nextStart: { hour: 9, minute: 0 }, nextDay: true };
}

/**
 * Find alternative available slots
 */
function findAlternativeSlots(
  startFrom: Date,
  durationMinutes: number,
  busyPeriods: Array<{ start?: string | null; end?: string | null }>,
  timezone: string,
  maxSlots: number,
  businessHours?: BusinessHours
): TimeSlot[] {
  const alternatives: TimeSlot[] = [];
  const slotDuration = durationMinutes * 60 * 1000;

  // Start checking from the requested time, in 30-minute increments
  let checkTime = new Date(startFrom);

  // Check for up to 3 days
  const maxCheckTime = new Date(startFrom);
  maxCheckTime.setDate(maxCheckTime.getDate() + 3);

  while (alternatives.length < maxSlots && checkTime < maxCheckTime) {
    const businessCheck = isWithinBusinessHours(checkTime, timezone, businessHours);

    if (!businessCheck.within) {
      // Skip to next valid business hours
      if (businessCheck.nextDay) {
        checkTime.setDate(checkTime.getDate() + 1);
      }
      if (businessCheck.nextStart) {
        checkTime.setHours(businessCheck.nextStart.hour, businessCheck.nextStart.minute, 0, 0);
      }
      continue;
    }

    const slotEnd = new Date(checkTime.getTime() + slotDuration);

    if (!isSlotBusy(checkTime, slotEnd, busyPeriods)) {
      alternatives.push({
        start: new Date(checkTime),
        end: slotEnd,
        startRFC3339: toRFC3339(checkTime, timezone),
        endRFC3339: toRFC3339(slotEnd, timezone),
      });
    }

    // Move to next 30-minute slot
    checkTime = new Date(checkTime.getTime() + 30 * 60 * 1000);
  }

  return alternatives;
}

/**
 * Format a time slot for human-readable output in the lead's timezone
 */
export function formatSlotForLead(slot: TimeSlot, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(slot.start);
}
