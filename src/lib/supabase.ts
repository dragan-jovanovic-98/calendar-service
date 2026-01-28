import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Service client for server-side operations (bypasses RLS)
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey);

// Types for our tables
export interface AvailabilityRule {
  days: number[];
  start: string;
  end: string;
}

export interface BusinessHours {
  rules: AvailabilityRule[];
}

export interface Vacation {
  start: string;
  end: string;
}

export interface MortgageClient {
  id: string;
  company_name: string;
  timezone: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  meeting_length: number | null;
  google_calendar_id: string | null;
  business_hours: BusinessHours | null;
  excluded_dates: string[] | null;
  holidays: string[] | null;
  vacations: Vacation[] | null;
}

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

// Fetch client by ID
export async function getClientById(clientId: string): Promise<MortgageClient | null> {
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
export async function updateClientOAuthTokens(
  clientId: string,
  tokens: GoogleOAuthTokens
): Promise<boolean> {
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
export async function updateClientCalendarId(
  clientId: string,
  calendarId: string
): Promise<boolean> {
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
export async function getLeadTimezone(
  campaignId: string | null | undefined,
  clientTimezone: string
): Promise<string> {
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

// Lead data with primary phone
export interface LeadWithPhone {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

// Fetch lead by ID with primary phone number
export async function getLeadById(leadId: string): Promise<LeadWithPhone | null> {
  const { data, error } = await supabase
    .from('mortgage_leads')
    .select(`
      id,
      first_name,
      last_name,
      email,
      mortgage_lead_phones!inner(phone_e164, is_primary)
    `)
    .eq('id', leadId)
    .single();

  if (error) {
    // Try without phone if no phone exists
    const { data: leadOnly, error: leadError } = await supabase
      .from('mortgage_leads')
      .select('id, first_name, last_name, email')
      .eq('id', leadId)
      .single();

    if (leadError) {
      console.error('Error fetching lead:', leadError);
      return null;
    }

    return {
      id: leadOnly.id,
      first_name: leadOnly.first_name,
      last_name: leadOnly.last_name,
      email: leadOnly.email,
      phone: null,
    };
  }

  // Find primary phone or use first available
  const phones = data.mortgage_lead_phones as Array<{ phone_e164: string; is_primary: boolean }>;
  const primaryPhone = phones.find(p => p.is_primary)?.phone_e164 || phones[0]?.phone_e164 || null;

  return {
    id: data.id,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: primaryPhone,
  };
}

// Create an appointment record
export async function createAppointment(
  clientId: string,
  leadId: string,
  startTime: Date,
  endTime: Date,
  timezone: string,
  calendarEventId: string,
  externalCallId?: string
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('mortgage_appointments')
    .insert({
      client_id: clientId,
      lead_id: leadId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      timezone,
      external_calendar_id: calendarEventId,
      external_call_id: externalCallId || '',
      status: 'scheduled',
      source: 'retell_voice',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating appointment:', error);
    throw new Error(`Failed to create appointment: ${error.message}`);
  }

  return { id: data.id };
}

// Update lead status
export async function updateLeadStatus(
  leadId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('mortgage_leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', leadId);

  if (error) {
    console.error('Error updating lead status:', error);
    throw new Error(`Failed to update lead status: ${error.message}`);
  }
}

// Check if a date/time is blocked by client settings
export function isTimeBlocked(
  dateTime: Date,
  client: MortgageClient
): { blocked: boolean; reason?: string } {
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
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

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
  const weekdayMap: Record<string, number> = {
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
        if (dateStr >= start! && dateStr <= end!) {
          return { blocked: true, reason: 'date excluded' };
        }
      } else {
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
      if (!rule.days.includes(dayOfWeek)) return false;
      if (timeStr < rule.start || timeStr >= rule.end) return false;
      return true;
    });

    if (!matchingRule) {
      return { blocked: true, reason: 'outside business hours' };
    }
  }

  return { blocked: false };
}
