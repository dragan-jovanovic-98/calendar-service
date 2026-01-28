import type { OAuth2Client } from 'google-auth-library';
export interface BusinessHoursRule {
    days: number[];
    start: string;
    end: string;
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
export declare function listCalendars(auth: OAuth2Client): Promise<CalendarInfo[]>;
export interface TimeSlot {
    start: Date;
    end: Date;
    startRFC3339: string;
    endRFC3339: string;
}
export interface AvailabilityResult {
    available: boolean;
    requestedSlot?: TimeSlot;
    busyPeriods: Array<{
        start: string;
        end: string;
    }>;
    alternatives: TimeSlot[];
}
/**
 * Check availability for a specific time slot
 */
export declare function checkSlotAvailability(auth: OAuth2Client, calendarId: string, startTime: Date, durationMinutes: number, timezone: string, businessHours?: BusinessHours): Promise<AvailabilityResult>;
/**
 * Find available slots within a time range (for "after 4pm" or "morning" requests)
 */
export declare function findAvailableSlotsInRange(auth: OAuth2Client, calendarId: string, rangeStart: Date, rangeEnd: Date, durationMinutes: number, timezone: string, maxSlots?: number, businessHours?: BusinessHours): Promise<TimeSlot[]>;
/**
 * Format a time slot for human-readable output in the lead's timezone
 */
export declare function formatSlotForLead(slot: TimeSlot, timezone: string): string;
export interface CalendarEventResult {
    eventId: string;
    htmlLink: string;
}
/**
 * Create a Google Calendar event
 */
export declare function createCalendarEvent(auth: OAuth2Client, calendarId: string, title: string, description: string, startTime: Date, durationMinutes: number, timezone: string, attendeeEmail?: string): Promise<CalendarEventResult>;
//# sourceMappingURL=google-calendar.d.ts.map