import { google } from 'googleapis';
import { toRFC3339, addMinutesToDate } from './date-parser.js';
/**
 * List all calendars the user has access to
 */
export async function listCalendars(auth) {
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
/**
 * Check availability for a specific time slot
 */
export async function checkSlotAvailability(auth, calendarId, startTime, durationMinutes, timezone, businessHours) {
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
    const requestedSlot = {
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
export async function findAvailableSlotsInRange(auth, calendarId, rangeStart, rangeEnd, durationMinutes, timezone, maxSlots = 3, businessHours) {
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
function isSlotBusy(slotStart, slotEnd, busyPeriods) {
    for (const busy of busyPeriods) {
        if (!busy.start || !busy.end)
            continue;
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
function getTimeInTimezone(date, timezone) {
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
    const weekdayMap = {
        'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    const dayOfWeek = weekdayMap[weekdayStr] ?? 1;
    return { hour, minute, dayOfWeek };
}
/**
 * Check if a time falls within business hours (simple boolean check)
 */
function isWithinBusinessHours(date, timezone, businessHours) {
    // Default business hours: Mon-Fri 9am-5pm
    const defaultRules = [
        { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }
    ];
    const rules = businessHours?.rules || defaultRules;
    const { hour, minute, dayOfWeek } = getTimeInTimezone(date, timezone);
    const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    // Find a rule that applies to this day
    for (const rule of rules) {
        if (rule.days.includes(dayOfWeek)) {
            if (currentTime >= rule.start && currentTime < rule.end) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Find alternative available slots
 */
function findAlternativeSlots(startFrom, durationMinutes, busyPeriods, timezone, maxSlots, businessHours) {
    const alternatives = [];
    const slotDuration = durationMinutes * 60 * 1000;
    const thirtyMinutes = 30 * 60 * 1000;
    // Start checking from the requested time, in 30-minute increments
    let checkTime = new Date(startFrom);
    // Check for up to 3 days (in 30-min increments = 144 iterations max)
    const maxCheckTime = new Date(startFrom);
    maxCheckTime.setDate(maxCheckTime.getDate() + 3);
    let iterations = 0;
    const maxIterations = 500; // Safety limit
    while (alternatives.length < maxSlots && checkTime < maxCheckTime && iterations < maxIterations) {
        iterations++;
        // Check if this time is within business hours
        if (isWithinBusinessHours(checkTime, timezone, businessHours)) {
            const slotEnd = new Date(checkTime.getTime() + slotDuration);
            if (!isSlotBusy(checkTime, slotEnd, busyPeriods)) {
                alternatives.push({
                    start: new Date(checkTime),
                    end: slotEnd,
                    startRFC3339: toRFC3339(checkTime, timezone),
                    endRFC3339: toRFC3339(slotEnd, timezone),
                });
            }
        }
        // Move to next 30-minute slot
        checkTime = new Date(checkTime.getTime() + thirtyMinutes);
    }
    return alternatives;
}
/**
 * Format a time slot for human-readable output in the lead's timezone
 */
export function formatSlotForLead(slot, timezone) {
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
/**
 * Create a Google Calendar event
 */
export async function createCalendarEvent(auth, calendarId, title, description, startTime, durationMinutes, timezone, attendeeEmail) {
    const calendar = google.calendar({ version: 'v3', auth });
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const event = {
        summary: title,
        description,
        start: {
            dateTime: toRFC3339(startTime, timezone),
            timeZone: timezone,
        },
        end: {
            dateTime: toRFC3339(endTime, timezone),
            timeZone: timezone,
        },
    };
    if (attendeeEmail) {
        event.attendees = [{ email: attendeeEmail }];
    }
    const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
        sendUpdates: attendeeEmail ? 'all' : 'none',
    });
    return {
        eventId: response.data.id || '',
        htmlLink: response.data.htmlLink || '',
    };
}
//# sourceMappingURL=google-calendar.js.map