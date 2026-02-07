import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../lib/google-oauth.js';
import {
  getWatchChannelByChannelId,
  updateWatchChannelSyncToken,
  clearWatchChannelSyncToken,
  getAppointmentByCalendarEventId,
  findLeadByEmail,
  createAppointmentFromGoogleBooking,
  getClientById,
  type WatchChannel,
  type MortgageClient,
} from '../lib/supabase.js';

export async function googleWebhookRoutes(server: FastifyInstance) {
  /**
   * Google Calendar push notification webhook.
   * Google POSTs here whenever events change on a watched calendar.
   *
   * Headers from Google:
   * - X-Goog-Channel-ID: our channel UUID
   * - X-Goog-Resource-State: "sync" (initial), "exists" (changes), "not_exists" (deleted)
   * - X-Goog-Resource-ID: Google's resource identifier
   */
  server.post('/webhook/google-calendar', async (request, reply) => {
    const channelId = request.headers['x-goog-channel-id'] as string | undefined;
    const resourceState = request.headers['x-goog-resource-state'] as string | undefined;

    // Google requires a fast 200 response
    reply.status(200).send();

    if (!channelId) {
      console.warn('Google webhook: missing X-Goog-Channel-ID header');
      return;
    }

    // "sync" is the initial notification when a watch is first created — acknowledge only
    if (resourceState === 'sync') {
      console.log(`Google webhook: sync notification for channel ${channelId}`);
      return;
    }

    // Process changes asynchronously (response already sent)
    processWebhookNotification(channelId).catch((error) => {
      console.error(`Error processing Google webhook for channel ${channelId}:`, error);
    });
  });
}

/**
 * Look up the watch channel and process calendar changes.
 */
async function processWebhookNotification(channelId: string): Promise<void> {
  const watchChannel = await getWatchChannelByChannelId(channelId);

  if (!watchChannel) {
    console.warn(`Google webhook: no active watch channel found for ${channelId}`);
    return;
  }

  const client = await getClientById(watchChannel.client_id);
  if (!client?.google_oauth_tokens) {
    console.warn(`Google webhook: client ${watchChannel.client_id} has no OAuth tokens`);
    return;
  }

  await processCalendarChanges(watchChannel, client);
}

/**
 * Fetch changed events using sync token, process new bookings.
 */
async function processCalendarChanges(
  watchChannel: WatchChannel,
  client: MortgageClient
): Promise<void> {
  const auth = await getAuthenticatedClient(watchChannel.client_id, client.google_oauth_tokens!);
  const calendar = google.calendar({ version: 'v3', auth });

  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  try {
    do {
      const listParams: {
        calendarId: string;
        singleEvents: boolean;
        maxResults: number;
        syncToken?: string;
        timeMin?: string;
        pageToken?: string;
      } = {
        calendarId: watchChannel.calendar_id,
        singleEvents: true,
        maxResults: 50,
      };

      if (watchChannel.sync_token) {
        // Incremental sync — only changes since last sync
        listParams.syncToken = watchChannel.sync_token;
      } else {
        // First sync — only look at future events to avoid importing history
        listParams.timeMin = new Date().toISOString();
      }

      if (pageToken) {
        listParams.pageToken = pageToken;
      }

      const response = await calendar.events.list(listParams);

      const events = response.data.items || [];
      nextSyncToken = response.data.nextSyncToken || undefined;
      pageToken = response.data.nextPageToken || undefined;

      for (const event of events) {
        try {
          await processSingleEvent(event, watchChannel.client_id, client);
        } catch (error) {
          console.error(`Error processing event ${event.id}:`, error);
        }
      }
    } while (pageToken);

    // Save the new sync token for next time
    if (nextSyncToken) {
      await updateWatchChannelSyncToken(watchChannel.id, nextSyncToken);
    }
  } catch (error: unknown) {
    // Handle 410 Gone — sync token expired, need full re-sync
    if (isGoogleApiError(error) && error.code === 410) {
      console.log(`Sync token expired for channel ${watchChannel.channel_id}, clearing for re-sync`);
      await clearWatchChannelSyncToken(watchChannel.id);
      return;
    }
    throw error;
  }
}

/**
 * Process a single calendar event — decide if it's a new external booking.
 */
async function processSingleEvent(
  event: {
    id?: string | null;
    status?: string | null;
    summary?: string | null;
    description?: string | null;
    htmlLink?: string | null;
    start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
    end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null;
    attendees?: Array<{ email?: string | null; self?: boolean | null; responseStatus?: string | null }> | null;
    creator?: { email?: string | null; self?: boolean | null } | null;
    organizer?: { email?: string | null; self?: boolean | null } | null;
  },
  clientId: string,
  client: MortgageClient
): Promise<void> {
  const eventId = event.id;
  if (!eventId) return;

  // Skip cancelled events
  if (event.status === 'cancelled') return;

  // Skip all-day events (no dateTime = all-day, uses date instead)
  if (!event.start?.dateTime || !event.end?.dateTime) return;

  // Skip events we already created (Retell bookings)
  const existingAppointment = await getAppointmentByCalendarEventId(eventId);
  if (existingAppointment) return;

  // Find external attendees (not the calendar owner)
  const externalAttendees = (event.attendees || []).filter(
    (attendee) => attendee.email && !attendee.self
  );

  // Skip events with no external attendees (broker's own blocks, internal meetings)
  if (externalAttendees.length === 0) {
    // Also check if the creator is external (booking pages sometimes don't add as attendee)
    if (!event.creator?.email || event.creator.self) {
      return;
    }
  }

  // Try to match to an existing lead by email
  let leadId: string | null = null;
  const attendeeEmail = externalAttendees[0]?.email || event.creator?.email;

  if (attendeeEmail) {
    const lead = await findLeadByEmail(clientId, attendeeEmail);
    if (lead) {
      leadId = lead.id;
    }
  }

  const timezone = event.start.timeZone || client.timezone || 'America/Toronto';

  // Create the appointment
  const result = await createAppointmentFromGoogleBooking({
    clientId,
    leadId,
    startTime: event.start.dateTime,
    endTime: event.end.dateTime,
    timezone,
    calendarEventId: eventId,
    title: event.summary || null,
    notes: event.description || null,
    externalBookingUrl: event.htmlLink || null,
  });

  console.log(
    `Created Google booking appointment ${result.id} for client ${clientId}` +
      (leadId ? ` (matched lead ${leadId})` : ' (no lead match)') +
      (attendeeEmail ? ` — attendee: ${attendeeEmail}` : '')
  );
}

/**
 * Type guard for Google API errors.
 */
function isGoogleApiError(error: unknown): error is { code: number; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'number'
  );
}
