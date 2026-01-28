import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
// Service client for server-side operations (bypasses RLS)
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey);
// Fetch client by ID
export async function getClientById(clientId) {
    const { data, error } = await supabase
        .from('mortgage_clients')
        .select(`
      id,
      company_name,
      timezone,
      google_oauth_tokens,
      meeting_length,
      google_calendar_id,
      business_hours,
      excluded_dates,
      holidays,
      vacations
    `)
        .eq('id', clientId)
        .single();
    if (error) {
        console.error('Error fetching client:', error);
        return null;
    }
    return data;
}
// Update client OAuth tokens
export async function updateClientOAuthTokens(clientId, tokens) {
    const { error } = await supabase
        .from('mortgage_clients')
        .update({ google_oauth_tokens: tokens })
        .eq('id', clientId);
    if (error) {
        console.error('Error updating OAuth tokens:', error);
        return false;
    }
    return true;
}
// Update client's selected Google Calendar
export async function updateClientCalendarId(clientId, calendarId) {
    const { error } = await supabase
        .from('mortgage_clients')
        .update({ google_calendar_id: calendarId })
        .eq('id', clientId);
    if (error) {
        console.error('Error updating calendar ID:', error);
        return false;
    }
    return true;
}
// Get campaign timezone, with fallback to client timezone
export async function getLeadTimezone(campaignId, clientTimezone) {
    if (!campaignId) {
        return clientTimezone;
    }
    const { data, error } = await supabase
        .from('mortgage_campaigns')
        .select('timezone')
        .eq('id', campaignId)
        .single();
    if (error || !data?.timezone) {
        return clientTimezone;
    }
    return data.timezone;
}
// Check if a date/time is blocked by client settings
export function isTimeBlocked(dateTime, client) {
    const timezone = client.timezone || 'America/Toronto';
    // Get date/time components in client's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
    });
    const parts = formatter.formatToParts(dateTime);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '';
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const weekdayStr = getPart('weekday');
    const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD in client timezone
    const monthDay = `${month}-${day}`; // MM-DD
    const timeStr = `${hour}:${minute}`; // HH:MM in client timezone
    // Map weekday string to number (0=Sunday, 1=Monday, etc.)
    const weekdayMap = {
        'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    const dayOfWeek = weekdayMap[weekdayStr] ?? 0;
    // Check vacation mode
    if (client.vacations && client.vacations.length > 0) {
        for (const vacation of client.vacations) {
            if (dateStr >= vacation.start && dateStr <= vacation.end) {
                return { blocked: true, reason: 'on vacation' };
            }
        }
    }
    // Check excluded dates (single dates and ranges)
    if (client.excluded_dates) {
        for (const excluded of client.excluded_dates) {
            if (excluded.includes('|')) {
                // Date range: "2025-01-30|2025-02-05"
                const [start, end] = excluded.split('|');
                if (dateStr >= start && dateStr <= end) {
                    return { blocked: true, reason: 'date excluded' };
                }
            }
            else {
                // Single date
                if (dateStr === excluded) {
                    return { blocked: true, reason: 'date excluded' };
                }
            }
        }
    }
    // Check holidays (yearly recurring, MM-DD format)
    if (client.holidays) {
        if (client.holidays.includes(monthDay)) {
            return { blocked: true, reason: 'holiday' };
        }
    }
    // Check business hours rules
    if (client.business_hours?.rules && client.business_hours.rules.length > 0) {
        // Find a matching rule
        const matchingRule = client.business_hours.rules.find(rule => {
            if (!rule.days.includes(dayOfWeek))
                return false;
            if (timeStr < rule.start || timeStr >= rule.end)
                return false;
            return true;
        });
        if (!matchingRule) {
            return { blocked: true, reason: 'outside business hours' };
        }
    }
    return { blocked: false };
}
//# sourceMappingURL=supabase.js.map