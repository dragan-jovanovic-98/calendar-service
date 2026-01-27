import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Service client for server-side operations (bypasses RLS)
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey);

// Types for our tables
export interface MortgageClient {
  id: string;
  company_name: string;
  timezone: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  meeting_lengths: number[];
  google_calendar_id: string | null;
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
    .select('id, company_name, timezone, google_oauth_tokens, meeting_lengths, google_calendar_id')
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
