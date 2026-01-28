import type { FastifyInstance } from 'fastify';
import { getClientById, getLeadTimezone, isTimeBlocked } from '../lib/supabase.js';
import { getAuthenticatedClient } from '../lib/google-oauth.js';
import { parseDateTime } from '../lib/date-parser.js';
import type { TimeSlot, BusinessHours } from '../lib/google-calendar.js';
import {
  checkSlotAvailability,
  findAvailableSlotsInRange,
  formatSlotForLead,
} from '../lib/google-calendar.js';

interface RetellWebhookBody {
  name: string;
  args: {
    requested_time_string?: string;
  };
  call: {
    metadata: {
      client_id: string;
      lead_id?: string;
      campaign_id?: string;
    };
  };
}

interface AvailabilityResponse {
  response: string; // Natural language response for Retell to speak
  available: boolean;
  requestedTime: string | null;
  alternatives: string[] | null;
  needsTimeSpecified?: boolean;
  suggestedSlots?: string[];
  error?: string;
}

// Format a list for speech (e.g., "10am, 2pm, and 4pm")
function formatListForSpeech(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Extract just the time part for shorter speech (e.g., "2:00 PM" from "Tuesday, Jan 27, 2:00 PM")
function extractTimeForSpeech(formatted: string): string {
  const match = formatted.match(/\d{1,2}:\d{2}\s*[AP]M/i);
  return match ? match[0] : formatted;
}

export async function webhookRoutes(server: FastifyInstance) {
  server.post<{ Body: RetellWebhookBody }>('/webhook/retell', async (request, reply) => {
    const { args, call } = request.body;
    const { client_id, campaign_id } = call.metadata;
    const requestedTimeString = args?.requested_time_string;

    // Validate client_id
    if (!client_id) {
      return reply.status(400).send({
        response: "I'm sorry, I'm having trouble checking the calendar right now.",
        available: false,
        requestedTime: null,
        alternatives: null,
        error: 'client_id is required in call metadata',
      } satisfies AvailabilityResponse);
    }

    // Fetch client data
    const client = await getClientById(client_id);
    if (!client) {
      return reply.status(404).send({
        response: "I'm sorry, I'm having trouble checking the calendar right now.",
        available: false,
        requestedTime: null,
        alternatives: null,
        error: 'Client not found',
      } satisfies AvailabilityResponse);
    }

    // Check if broker is on vacation
    const today = new Date();
    const vacationCheck = isTimeBlocked(today, client);
    if (vacationCheck.blocked && vacationCheck.reason === 'on vacation') {
      return {
        response: "I'm sorry, we're currently unavailable. Can I take your number and have someone call you back when we return?",
        available: false,
        requestedTime: null,
        alternatives: null,
        error: 'Broker is on vacation',
      } satisfies AvailabilityResponse;
    }

    // Check if client has connected Google Calendar
    if (!client.google_oauth_tokens) {
      return reply.status(400).send({
        response: "I'm sorry, the calendar isn't set up yet. Can I take your number and have someone call you back?",
        available: false,
        requestedTime: null,
        alternatives: null,
        error: 'Client has not connected Google Calendar',
      } satisfies AvailabilityResponse);
    }

    // Get lead timezone (from campaign, fallback to client)
    const leadTimezone = await getLeadTimezone(campaign_id, client.timezone);
    const calendarId = client.google_calendar_id || 'primary';
    const meetingLength = client.meeting_length || 30;
    const businessHours = client.business_hours as BusinessHours | undefined;

    // Helper to filter slots by business hours
    const filterSlotsByBusinessHours = (slots: TimeSlot[]): TimeSlot[] => {
      return slots.filter(slot => !isTimeBlocked(slot.start, client).blocked);
    };

    // If no time requested, return available slots for today
    if (!requestedTimeString) {
      try {
        const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);
        const now = new Date();
        const endOfDay = new Date(now);
        endOfDay.setHours(20, 0, 0, 0);

        const slots = await findAvailableSlotsInRange(
          auth,
          calendarId,
          now,
          endOfDay,
          meetingLength,
          client.timezone,
          10, // Fetch more to account for filtering
          businessHours
        );

        // Filter by business hours
        const filteredSlots = filterSlotsByBusinessHours(slots).slice(0, 3);

        const formattedSlots = filteredSlots.map(s => formatSlotForLead(s, leadTimezone));
        const timesForSpeech = formattedSlots.map(extractTimeForSpeech);
        const response = formattedSlots.length > 0
          ? `I have ${formatListForSpeech(timesForSpeech)} available.`
          : "I don't have any availability right now.";

        return {
          response,
          available: formattedSlots.length > 0,
          requestedTime: null,
          alternatives: null,
          suggestedSlots: formattedSlots,
        } satisfies AvailabilityResponse;
      } catch (err) {
        console.error('Error fetching available slots:', err);
        return reply.status(500).send({
          response: "I'm sorry, I'm having trouble checking the calendar right now.",
          available: false,
          requestedTime: null,
          alternatives: null,
          error: 'Failed to check calendar availability',
        } satisfies AvailabilityResponse);
      }
    }

    // Parse the requested time in the lead's timezone
    const parseResult = parseDateTime(requestedTimeString, leadTimezone);

    if (!parseResult.success) {
      return reply.status(400).send({
        response: "I didn't quite catch that time. Could you say it again?",
        available: false,
        requestedTime: requestedTimeString,
        alternatives: null,
        error: parseResult.error || 'Could not parse requested time',
      } satisfies AvailabilityResponse);
    }

    // If only a day was specified (e.g., "Wednesday"), ask for time
    if (parseResult.needsTimeSpecified) {
      try {
        const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);

        const slots = await findAvailableSlotsInRange(
          auth,
          calendarId,
          parseResult.rangeStart!,
          parseResult.rangeEnd!,
          meetingLength,
          client.timezone,
          10,
          businessHours
        );

        // Filter by business hours (double-check for vacations/excluded dates)
        const filteredSlots = filterSlotsByBusinessHours(slots).slice(0, 3);

        const formattedSlots = filteredSlots.map(s => formatSlotForLead(s, leadTimezone));
        const timesForSpeech = formattedSlots.map(extractTimeForSpeech);
        const response = formattedSlots.length > 0
          ? `I have ${formatListForSpeech(timesForSpeech)} available. What time works best for you?`
          : "I don't have availability that day. Would another day work?";

        return {
          response,
          available: false,
          requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
          alternatives: null,
          needsTimeSpecified: true,
          suggestedSlots: formattedSlots,
        } satisfies AvailabilityResponse;
      } catch (err) {
        console.error('Error fetching suggested slots:', err);
        return {
          response: "I'm having trouble checking that day. Could you try a different day?",
          available: false,
          requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
          alternatives: null,
          needsTimeSpecified: true,
          error: 'Could not fetch available times',
        } satisfies AvailabilityResponse;
      }
    }

    // Check availability for specific time or range
    try {
      const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);

      if (parseResult.isRange) {
        // For ranges like "after 4pm", find first available slot
        const slots = await findAvailableSlotsInRange(
          auth,
          calendarId,
          parseResult.rangeStart!,
          parseResult.rangeEnd!,
          meetingLength,
          client.timezone,
          10,
          businessHours
        );

        // Filter by business hours (double-check for vacations/excluded dates)
        const filteredSlots = filterSlotsByBusinessHours(slots).slice(0, 3);

        if (filteredSlots.length > 0) {
          const firstSlot = filteredSlots[0]!;
          const formattedTime = formatSlotForLead(firstSlot, leadTimezone);
          const firstTimeForSpeech = extractTimeForSpeech(formattedTime);
          const alternatives = filteredSlots.slice(1).map(s => formatSlotForLead(s, leadTimezone));

          return {
            response: `${firstTimeForSpeech} is available.`,
            available: true,
            requestedTime: formattedTime,
            alternatives: alternatives.length > 0 ? alternatives : null,
          } satisfies AvailabilityResponse;
        } else {
          return {
            response: "I don't have any availability in that time range. Would a different time work?",
            available: false,
            requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
            alternatives: null,
            error: 'No availability in requested time range',
          } satisfies AvailabilityResponse;
        }
      } else {
        // Specific time requested - first check if it's blocked by business hours
        const requestedSlot = parseResult.slot!.start;
        const blockCheck = isTimeBlocked(requestedSlot, client);

        if (blockCheck.blocked) {
          // Time is outside business hours or excluded, find alternatives
          const rangeStart = new Date(requestedSlot);
          rangeStart.setHours(9, 0, 0, 0);
          const rangeEnd = new Date(requestedSlot);
          rangeEnd.setHours(20, 0, 0, 0);

          const slots = await findAvailableSlotsInRange(
            auth,
            calendarId,
            rangeStart,
            rangeEnd,
            meetingLength,
            client.timezone,
            10,
            businessHours
          );

          // Filter for vacations/excluded dates
          const filteredSlots = filterSlotsByBusinessHours(slots).slice(0, 3);
          const formattedAlternatives = filteredSlots.map(s => formatSlotForLead(s, leadTimezone));
          const alternativeTimesForSpeech = formattedAlternatives.map(extractTimeForSpeech);

          const response = formattedAlternatives.length > 0
            ? `That time isn't available, but ${formatListForSpeech(alternativeTimesForSpeech)} ${formattedAlternatives.length === 1 ? 'is' : 'are'}.`
            : "That time isn't available. Would a different day work?";

          return {
            response,
            available: false,
            requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
            alternatives: formattedAlternatives.length > 0 ? formattedAlternatives : null,
          } satisfies AvailabilityResponse;
        }

        // Time is within business hours, check Google Calendar
        const result = await checkSlotAvailability(
          auth,
          calendarId,
          parseResult.slot!.start,
          meetingLength,
          client.timezone,
          businessHours
        );

        const formattedRequestedTime = formatSlotForLead(result.requestedSlot!, leadTimezone);
        const requestedTimeForSpeech = extractTimeForSpeech(formattedRequestedTime);

        // Filter alternatives by business hours
        const filteredAlternatives = filterSlotsByBusinessHours(result.alternatives);
        const formattedAlternatives = filteredAlternatives.map(s => formatSlotForLead(s, leadTimezone));
        const alternativeTimesForSpeech = formattedAlternatives.map(extractTimeForSpeech);

        let response: string;
        if (result.available) {
          response = `${requestedTimeForSpeech} is available.`;
        } else if (formattedAlternatives.length > 0) {
          response = `${requestedTimeForSpeech} isn't available, but ${formatListForSpeech(alternativeTimesForSpeech)} ${formattedAlternatives.length === 1 ? 'is' : 'are'}.`;
        } else {
          response = `${requestedTimeForSpeech} isn't available. Would a different time work?`;
        }

        return {
          response,
          available: result.available,
          requestedTime: formattedRequestedTime,
          alternatives: formattedAlternatives.length > 0 ? formattedAlternatives : null,
        } satisfies AvailabilityResponse;
      }
    } catch (err) {
      console.error('Error checking availability:', err);
      return reply.status(500).send({
        response: "I'm sorry, I'm having trouble checking the calendar right now.",
        available: false,
        requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
        alternatives: null,
        error: 'Failed to check calendar availability',
      } satisfies AvailabilityResponse);
    }
  });
}
