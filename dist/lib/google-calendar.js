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
export async function checkSlotAvailability(auth, calendarId, startTime, durationMinutes, timezone) {
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
        : findAlternativeSlots(startTime, durationMinutes, busyPeriods, timezone, 3);
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
export async function findAvailableSlotsInRange(auth, calendarId, rangeStart, rangeEnd, durationMinutes, timezone, maxSlots = 3) {
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
    return findAlternativeSlots(rangeStart, durationMinutes, busyPeriods, timezone, maxSlots);
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
 * Find alternative available slots
 */
function findAlternativeSlots(startFrom, durationMinutes, busyPeriods, timezone, maxSlots) {
    const alternatives = [];
    const slotDuration = durationMinutes * 60 * 1000;
    // Start checking from the requested time, in 30-minute increments
    let checkTime = new Date(startFrom);
    // Check for up to 3 days
    const maxCheckTime = new Date(startFrom);
    maxCheckTime.setDate(maxCheckTime.getDate() + 3);
    while (alternatives.length < maxSlots && checkTime < maxCheckTime) {
        const hour = checkTime.getHours();
        // Skip non-business hours (before 9am or after 8pm)
        if (hour < 9) {
            checkTime.setHours(9, 0, 0, 0);
            continue;
        }
        if (hour >= 20) {
            // Move to next day at 9am
            checkTime.setDate(checkTime.getDate() + 1);
            checkTime.setHours(9, 0, 0, 0);
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
//# sourceMappingURL=google-calendar.js.map