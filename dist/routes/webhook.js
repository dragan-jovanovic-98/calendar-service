import { getClientById, getLeadTimezone, isTimeBlocked, getLeadById, createAppointment, updateLeadStatus, } from '../lib/supabase.js';
import { getAuthenticatedClient } from '../lib/google-oauth.js';
import { parseDateTime } from '../lib/date-parser.js';
import { checkSlotAvailability, findAvailableSlotsInRange, formatSlotForLead, createCalendarEvent, } from '../lib/google-calendar.js';
// Format a list for speech (e.g., "10am, 2pm, and 4pm")
function formatListForSpeech(items) {
    if (items.length === 0)
        return '';
    if (items.length === 1)
        return items[0];
    if (items.length === 2)
        return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
// Extract just the time part for shorter speech (e.g., "2:00 PM" from "Tuesday, Jan 27, 2:00 PM")
function extractTimeForSpeech(formatted) {
    const match = formatted.match(/\d{1,2}:\d{2}\s*[AP]M/i);
    return match ? match[0] : formatted;
}
export async function webhookRoutes(server) {
    server.post('/webhook/retell', async (request, reply) => {
        const { name, args, call } = request.body;
        const { client_id, lead_id, campaign_id } = call.metadata;
        const requestedTimeString = args?.requested_time_string;
        // Route to appropriate handler based on function name
        if (name === 'book_appointment') {
            return handleBookAppointment(request, reply, client_id, lead_id, campaign_id, requestedTimeString);
        }
        // Default: check_availability handler (existing logic)
        // Validate client_id
        if (!client_id) {
            return reply.status(400).send({
                response: "I'm sorry, I'm having trouble checking the calendar right now.",
                available: false,
                requestedTime: null,
                alternatives: null,
                error: 'client_id is required in call metadata',
            });
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
            });
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
            };
        }
        // Check if client has connected Google Calendar
        if (!client.google_oauth_tokens) {
            return reply.status(400).send({
                response: "I'm sorry, the calendar isn't set up yet. Can I take your number and have someone call you back?",
                available: false,
                requestedTime: null,
                alternatives: null,
                error: 'Client has not connected Google Calendar',
            });
        }
        // Get lead timezone (from campaign, fallback to client)
        const leadTimezone = await getLeadTimezone(campaign_id, client.timezone);
        const calendarId = client.google_calendar_id || 'primary';
        const meetingLength = client.meeting_length || 30;
        const businessHours = client.business_hours;
        const bufferMinutes = client.buffer_minutes || 0;
        // Helper to filter slots by business hours
        const filterSlotsByBusinessHours = (slots) => {
            return slots.filter(slot => !isTimeBlocked(slot.start, client).blocked);
        };
        // If no time requested, return available slots for today
        if (!requestedTimeString) {
            try {
                const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);
                // Round up to next 30-minute slot for cleaner times
                const now = new Date();
                const minutes = now.getMinutes();
                if (minutes > 0 && minutes <= 30) {
                    now.setMinutes(30, 0, 0);
                }
                else if (minutes > 30) {
                    now.setHours(now.getHours() + 1);
                    now.setMinutes(0, 0, 0);
                }
                else {
                    now.setSeconds(0, 0);
                }
                const endOfDay = new Date(now);
                endOfDay.setHours(20, 0, 0, 0);
                const slots = await findAvailableSlotsInRange(auth, calendarId, now, endOfDay, meetingLength, client.timezone, 10, // Fetch more to account for filtering
                businessHours, bufferMinutes);
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
                };
            }
            catch (err) {
                console.error('Error fetching available slots:', err);
                return reply.status(500).send({
                    response: "I'm sorry, I'm having trouble checking the calendar right now.",
                    available: false,
                    requestedTime: null,
                    alternatives: null,
                    error: 'Failed to check calendar availability',
                });
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
            });
        }
        // If only a day was specified (e.g., "Wednesday"), ask for time
        if (parseResult.needsTimeSpecified) {
            try {
                const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);
                const slots = await findAvailableSlotsInRange(auth, calendarId, parseResult.rangeStart, parseResult.rangeEnd, meetingLength, client.timezone, 10, businessHours, bufferMinutes);
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
                };
            }
            catch (err) {
                console.error('Error fetching suggested slots:', err);
                return {
                    response: "I'm having trouble checking that day. Could you try a different day?",
                    available: false,
                    requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
                    alternatives: null,
                    needsTimeSpecified: true,
                    error: 'Could not fetch available times',
                };
            }
        }
        // Check availability for specific time or range
        try {
            const auth = await getAuthenticatedClient(client_id, client.google_oauth_tokens);
            if (parseResult.isRange) {
                // For ranges like "after 4pm", find first available slot
                const slots = await findAvailableSlotsInRange(auth, calendarId, parseResult.rangeStart, parseResult.rangeEnd, meetingLength, client.timezone, 10, businessHours, bufferMinutes);
                // Filter by business hours (double-check for vacations/excluded dates)
                const filteredSlots = filterSlotsByBusinessHours(slots).slice(0, 3);
                if (filteredSlots.length > 0) {
                    const firstSlot = filteredSlots[0];
                    const formattedTime = formatSlotForLead(firstSlot, leadTimezone);
                    const firstTimeForSpeech = extractTimeForSpeech(formattedTime);
                    const alternatives = filteredSlots.slice(1).map(s => formatSlotForLead(s, leadTimezone));
                    return {
                        response: `${firstTimeForSpeech} is available.`,
                        available: true,
                        requestedTime: formattedTime,
                        alternatives: alternatives.length > 0 ? alternatives : null,
                    };
                }
                else {
                    return {
                        response: "I don't have any availability in that time range. Would a different time work?",
                        available: false,
                        requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
                        alternatives: null,
                        error: 'No availability in requested time range',
                    };
                }
            }
            else {
                // Specific time requested - first check if it's blocked by business hours
                const requestedSlot = parseResult.slot.start;
                const blockCheck = isTimeBlocked(requestedSlot, client);
                if (blockCheck.blocked) {
                    // Time is outside business hours or excluded, find alternatives
                    const rangeStart = new Date(requestedSlot);
                    rangeStart.setHours(9, 0, 0, 0);
                    const rangeEnd = new Date(requestedSlot);
                    rangeEnd.setHours(20, 0, 0, 0);
                    const slots = await findAvailableSlotsInRange(auth, calendarId, rangeStart, rangeEnd, meetingLength, client.timezone, 10, businessHours, bufferMinutes);
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
                    };
                }
                // Time is within business hours, check Google Calendar
                const result = await checkSlotAvailability(auth, calendarId, parseResult.slot.start, meetingLength, client.timezone, businessHours, bufferMinutes);
                const formattedRequestedTime = formatSlotForLead(result.requestedSlot, leadTimezone);
                const requestedTimeForSpeech = extractTimeForSpeech(formattedRequestedTime);
                // Filter alternatives by business hours
                const filteredAlternatives = filterSlotsByBusinessHours(result.alternatives);
                const formattedAlternatives = filteredAlternatives.map(s => formatSlotForLead(s, leadTimezone));
                const alternativeTimesForSpeech = formattedAlternatives.map(extractTimeForSpeech);
                let response;
                if (result.available) {
                    response = `${requestedTimeForSpeech} is available.`;
                }
                else if (formattedAlternatives.length > 0) {
                    response = `${requestedTimeForSpeech} isn't available, but ${formatListForSpeech(alternativeTimesForSpeech)} ${formattedAlternatives.length === 1 ? 'is' : 'are'}.`;
                }
                else {
                    response = `${requestedTimeForSpeech} isn't available. Would a different time work?`;
                }
                return {
                    response,
                    available: result.available,
                    requestedTime: formattedRequestedTime,
                    alternatives: formattedAlternatives.length > 0 ? formattedAlternatives : null,
                };
            }
        }
        catch (err) {
            console.error('Error checking availability:', err);
            return reply.status(500).send({
                response: "I'm sorry, I'm having trouble checking the calendar right now.",
                available: false,
                requestedTime: parseResult.slot?.humanReadable || requestedTimeString,
                alternatives: null,
                error: 'Failed to check calendar availability',
            });
        }
    });
}
// Handler for book_appointment function
async function handleBookAppointment(request, reply, clientId, leadId, campaignId, requestedTimeString) {
    // Validate required metadata
    if (!clientId) {
        return reply.status(400).send({
            response: "I'm sorry, I'm having trouble booking right now.",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'client_id is required in call metadata',
        });
    }
    if (!leadId) {
        return reply.status(400).send({
            response: "I'm sorry, I'm having trouble booking right now.",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'lead_id is required in call metadata',
        });
    }
    if (!requestedTimeString) {
        return reply.status(400).send({
            response: "What time would you like to book?",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'requested_time_string is required',
        });
    }
    // Fetch client data
    const client = await getClientById(clientId);
    if (!client) {
        return reply.status(404).send({
            response: "I'm sorry, I'm having trouble booking right now.",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'Client not found',
        });
    }
    // Check if client has connected Google Calendar
    if (!client.google_oauth_tokens) {
        return reply.status(400).send({
            response: "I'm sorry, the calendar isn't set up yet. Can I take your number and have someone call you back?",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'Client has not connected Google Calendar',
        });
    }
    // Fetch lead data
    const lead = await getLeadById(leadId);
    if (!lead) {
        return reply.status(404).send({
            response: "I'm sorry, I'm having trouble booking right now.",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'Lead not found',
        });
    }
    // Get lead timezone (from campaign, fallback to client)
    const leadTimezone = await getLeadTimezone(campaignId, client.timezone);
    const calendarId = client.google_calendar_id || 'primary';
    const meetingLength = client.meeting_length || 30;
    const businessHours = client.business_hours;
    const bufferMinutes = client.buffer_minutes || 0;
    // Parse the requested time
    const parseResult = parseDateTime(requestedTimeString, leadTimezone);
    if (!parseResult.success || !parseResult.slot) {
        return reply.status(400).send({
            response: "I didn't quite catch that time. Could you say it again?",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: parseResult.error || 'Could not parse requested time',
        });
    }
    // For ranges or day-only requests, we need a specific time
    if (parseResult.isRange || parseResult.needsTimeSpecified) {
        return reply.status(400).send({
            response: "I need a specific time to book. What time works for you?",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'A specific time is required for booking',
        });
    }
    const requestedSlot = parseResult.slot.start;
    // Check if time is blocked by business hours
    const blockCheck = isTimeBlocked(requestedSlot, client);
    if (blockCheck.blocked) {
        return {
            response: `I'm sorry, that time isn't available. ${blockCheck.reason === 'outside business hours' ? 'It\'s outside of business hours.' : 'That date is blocked.'}`,
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: `Time blocked: ${blockCheck.reason}`,
        };
    }
    try {
        const auth = await getAuthenticatedClient(clientId, client.google_oauth_tokens);
        // Verify the slot is still available (prevent double-booking)
        const availabilityCheck = await checkSlotAvailability(auth, calendarId, requestedSlot, meetingLength, client.timezone, businessHours, bufferMinutes);
        if (!availabilityCheck.available) {
            const formattedTime = formatSlotForLead(availabilityCheck.requestedSlot, leadTimezone);
            return {
                response: `I'm sorry, ${extractTimeForSpeech(formattedTime)} was just booked. Would you like a different time?`,
                booked: false,
                appointmentTime: formattedTime,
                calendarEventId: null,
                error: 'Requested time is no longer available',
            };
        }
        // Build names
        const leadName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead';
        const brokerName = [client.broker_first_name, client.broker_last_name].filter(Boolean).join(' ') || client.company_name;
        // Build event description (lead-facing since they receive the invite)
        let description = `You will receive a phone call from ${brokerName}.`;
        if (client.business_phone) {
            description += `\n\nBroker Phone: ${client.business_phone}`;
        }
        if (lead.phone) {
            description += `\nYour Phone: ${lead.phone}`;
        }
        if (lead.email) {
            description += `\nYour Email: ${lead.email}`;
        }
        // Create Google Calendar event
        const eventResult = await createCalendarEvent(auth, calendarId, `Meeting with ${leadName}`, description, requestedSlot, meetingLength, client.timezone, lead.email || undefined // Only add as attendee if they have email
        );
        // Calculate end time
        const endTime = new Date(requestedSlot.getTime() + meetingLength * 60 * 1000);
        // Store appointment in database
        await createAppointment(clientId, leadId, requestedSlot, endTime, client.timezone, eventResult.eventId, request.body.call.metadata.client_id // Using client_id as fallback since external_call_id isn't in metadata
        );
        // Update lead status
        await updateLeadStatus(leadId, 'appointment_booked');
        // Format the time for response
        const formattedTime = formatSlotForLead(availabilityCheck.requestedSlot, leadTimezone);
        return {
            response: `You're all set for ${formattedTime}.`,
            booked: true,
            appointmentTime: formattedTime,
            calendarEventId: eventResult.eventId,
        };
    }
    catch (err) {
        console.error('Error booking appointment:', err);
        return reply.status(500).send({
            response: "I'm sorry, I couldn't complete the booking. Can we try again?",
            booked: false,
            appointmentTime: null,
            calendarEventId: null,
            error: 'Failed to create calendar event',
        });
    }
}
//# sourceMappingURL=webhook.js.map