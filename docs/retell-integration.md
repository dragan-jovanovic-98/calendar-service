# Retell AI Integration Guide

This guide explains how to set up the calendar availability checking system with Retell AI voice agents.

## Overview

The system allows Retell AI voice agents to check a broker's Google Calendar availability in real-time during calls. When a lead asks about scheduling, the agent calls our webhook to check availability and responds with open time slots.

**Flow:**
1. Retell triggers an outbound call with `client_id` and `campaign_id` in metadata
2. Lead asks about availability (e.g., "Do you have Tuesday at 2pm?")
3. Retell calls our webhook with the requested time
4. Webhook checks Google Calendar and returns availability
5. Agent speaks the response to the lead

---

## 1. Database Setup (Supabase)

### Client Configuration (`mortgage_clients` table)

Each client (broker) needs the following configured:

| Field | Required | Description |
|-------|----------|-------------|
| `timezone` | Yes | Client's timezone (e.g., `America/Vancouver`). Used for business hours. |
| `business_hours` | Yes | JSON defining when the broker is available |
| `meeting_length` | Yes | Default meeting duration in minutes (e.g., `30`) |
| `google_oauth_tokens` | Yes | Encrypted OAuth tokens (set via OAuth flow) |
| `google_calendar_id` | Yes | Calendar ID to check (set via dashboard) |
| `vacations` | No | Array of date ranges when broker is unavailable |
| `excluded_dates` | No | Specific dates to block |
| `holidays` | No | Recurring yearly holidays (MM-DD format) |

**Business Hours Format:**
```json
{
  "rules": [
    {
      "days": [1, 2, 3, 4, 5],
      "start": "09:00",
      "end": "17:00"
    }
  ]
}
```
- Days: 0=Sunday, 1=Monday, ..., 6=Saturday
- Multiple rules supported (e.g., different hours on weekends)

### Campaign Configuration (`mortgage_campaigns` table)

| Field | Required | Description |
|-------|----------|-------------|
| `timezone` | No | Lead's timezone for this campaign. Falls back to client timezone if not set. |
| `client_id` | Yes | Links campaign to the client/broker |

**Why campaign timezone matters:**
- Lead says "3pm" → parsed in campaign timezone
- Calendar checked in client timezone
- Response formatted in campaign timezone

Example: Campaign is `America/Toronto` (ET), client is `America/Vancouver` (PT)
- Lead asks for "12pm" (noon ET)
- System checks 9am PT on broker's calendar
- Responds "12pm is available" (in lead's timezone)

---

## 2. Dashboard Setup (Broker Portal)

The broker needs to complete these steps in the dashboard:

### Step 1: Connect Google Calendar
1. Go to Settings → Calendar Integration
2. Click "Connect Google Calendar"
3. Authorize access to Google Calendar
4. System automatically selects primary calendar (can be changed)

### Step 2: Configure Business Hours
1. Go to Settings → Availability
2. Set working days and hours
3. Add any blocked dates, vacations, or holidays

### Step 3: Set Meeting Length
1. Go to Settings → Appointments
2. Set default meeting duration (15, 30, 60 minutes)

---

## 3. Retell Setup

### Agent Configuration

When creating/configuring the Retell agent:

1. **Add the Custom Function:**

   | Setting | Value |
   |---------|-------|
   | Function Name | `check_availability` |
   | Webhook URL | `https://calendar.courtside-ai.com/webhook/retell` |
   | Method | POST |

2. **Function Parameters:**

   | Name | Type | Required | Description |
   |------|------|----------|-------------|
   | `requested_time_string` | string | No | The time the user requested |

3. **Function Description (for the LLM):**
   ```
   Check calendar availability for scheduling an appointment. Call this when
   the user wants to book a meeting or asks about available times. Pass the
   user's requested time as a string (e.g., "Tuesday at 2pm", "tomorrow
   morning", "next Wednesday"). If the user just asks "what's available"
   without specifying a time, call without the parameter.
   ```

### Triggering Calls with Metadata

When creating outbound calls via API, include `client_id` and `campaign_id` in metadata:

```bash
curl -X POST https://api.retellai.com/v2/create-phone-call \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_number": "+1234567890",
    "to_number": "+1987654321",
    "override_agent_id": "agent_xxx",
    "metadata": {
      "client_id": "uuid-of-client",
      "campaign_id": "uuid-of-campaign"
    }
  }'
```

**Required metadata:**
- `client_id` - UUID of the broker/client (required)
- `campaign_id` - UUID of the campaign (optional, for timezone)
- `lead_id` - UUID of the lead (optional, for future booking)

---

## 4. Webhook Reference

### Endpoint
```
POST https://calendar.courtside-ai.com/webhook/retell
```

### Request Format (from Retell)
```json
{
  "name": "check_availability",
  "args": {
    "requested_time_string": "Tuesday at 2pm"
  },
  "call": {
    "metadata": {
      "client_id": "9887eccf-8f8b-4d4c-a3ea-55b581f89f5f",
      "campaign_id": "bc89be53-2196-496e-8eae-8527da4571da"
    }
  }
}
```

### Response Format
```json
{
  "response": "2:00 PM is available.",
  "available": true,
  "requestedTime": "Tuesday, Feb 3, 2:00 PM",
  "alternatives": null
}
```

**Response fields:**
| Field | Type | Description |
|-------|------|-------------|
| `response` | string | Natural language for agent to speak |
| `available` | boolean | Whether requested time is available |
| `requestedTime` | string | Formatted requested time (in lead timezone) |
| `alternatives` | string[] or null | Alternative times if unavailable |
| `suggestedSlots` | string[] | Available slots (when no time specified) |
| `needsTimeSpecified` | boolean | True when only a day was given |

### Supported Time Formats

The system understands natural language times:

| Input | Interpretation |
|-------|---------------|
| "Tuesday at 2pm" | Next Tuesday, 2:00 PM |
| "tomorrow morning" | Tomorrow, 9:00 AM - 12:00 PM |
| "Wednesday afternoon" | Next Wednesday, 12:00 PM - 5:00 PM |
| "next Monday" | Monday of next week |
| "Friday after 3pm" | This Friday, 3:00 PM onwards |
| "Wednesday" | Asks for time preference, shows available slots |
| (no time) | Returns today's available slots |

---

## 5. Testing

### Test Script
A test script is available at `scripts/test-retell-call.sh`:
```bash
./scripts/test-retell-call.sh
```

### Manual Testing
Test the webhook directly with curl:
```bash
curl -X POST https://calendar.courtside-ai.com/webhook/retell \
  -H "Content-Type: application/json" \
  -d '{
    "name": "check_availability",
    "args": {"requested_time_string": "Tuesday at 2pm"},
    "call": {"metadata": {"client_id": "YOUR_CLIENT_ID"}}
  }'
```

---

## 6. Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "I'm having trouble checking the calendar" | Client not found or no OAuth | Verify client_id and Google Calendar connection |
| Wrong timezone in response | Campaign timezone not set | Set timezone on the campaign |
| "That time isn't available" for valid times | Outside business hours | Check client's business_hours settings |
| No alternatives offered | No availability in 3-day window | Check calendar isn't fully booked |

---

## 7. Appointment Booking

Once availability is confirmed, use `book_appointment` to create the calendar event and record the appointment.

### Agent Configuration for Booking

1. **Add the Custom Function:**

   | Setting | Value |
   |---------|-------|
   | Function Name | `book_appointment` |
   | Webhook URL | `https://calendar.courtside-ai.com/webhook/retell` |
   | Method | POST |

2. **Function Parameters:**

   | Name | Type | Required | Description |
   |------|------|----------|-------------|
   | `requested_time_string` | string | Yes | The confirmed time to book (e.g., "Tuesday at 2pm") |

3. **Required Metadata:**
   - `client_id` - UUID of the broker/client (required)
   - `lead_id` - UUID of the lead (required for booking)
   - `campaign_id` - UUID of the campaign (optional, for timezone)

4. **Function Description (for the LLM):**
   ```
   Book an appointment on the calendar. Call this ONLY after confirming
   availability with check_availability AND getting the lead's confirmation
   that they want that time. Pass the exact time they confirmed (e.g.,
   "Tuesday at 2pm"). The lead_id must be in the call metadata.
   ```

### Booking Flow

1. Agent: "Do you have Tuesday at 2pm?"
2. System: `check_availability` → "2:00 PM is available."
3. Agent: "Great, should I book that for you?"
4. Lead: "Yes, please."
5. System: `book_appointment` → "You're all set for Tuesday, Feb 3, 2:00 PM."
6. Agent: Confirms the booking

### What Happens When Booking

1. **Validates** the time is still available (prevents double-booking)
2. **Creates Google Calendar event** with:
   - Title: "Meeting with {lead name}"
   - Lead's phone and email in description
   - Calendar invite sent to lead (if they have email)
3. **Records appointment** in `mortgage_appointments` table
4. **Updates lead status** to `appointment_booked`

### Booking Request Format
```json
{
  "name": "book_appointment",
  "args": {
    "requested_time_string": "Tuesday at 2pm"
  },
  "call": {
    "metadata": {
      "client_id": "9887eccf-8f8b-4d4c-a3ea-55b581f89f5f",
      "lead_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "campaign_id": "bc89be53-2196-496e-8eae-8527da4571da"
    }
  }
}
```

### Booking Response Format

**Success:**
```json
{
  "response": "You're all set for Tuesday, Feb 3, 2:00 PM.",
  "booked": true,
  "appointmentTime": "Tuesday, Feb 3, 2:00 PM",
  "calendarEventId": "abc123xyz"
}
```

**Failure (time no longer available):**
```json
{
  "response": "I'm sorry, 2:00 PM was just booked. Would you like a different time?",
  "booked": false,
  "appointmentTime": "Tuesday, Feb 3, 2:00 PM",
  "calendarEventId": null,
  "error": "Requested time is no longer available"
}
```

**Failure (outside business hours):**
```json
{
  "response": "I'm sorry, that time isn't available. It's outside of business hours.",
  "booked": false,
  "appointmentTime": null,
  "calendarEventId": null,
  "error": "Time blocked: outside business hours"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `response` | string | Natural language for agent to speak |
| `booked` | boolean | Whether the booking was successful |
| `appointmentTime` | string or null | Formatted appointment time |
| `calendarEventId` | string or null | Google Calendar event ID (for reference) |
| `error` | string | Error message (only on failure) |

### Troubleshooting Booking Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "lead_id is required" | Missing lead_id in metadata | Ensure lead_id is passed when creating the call |
| "Time blocked" | Outside business hours or excluded date | Check client's business_hours settings |
| "Requested time is no longer available" | Someone else booked it | Suggest alternative times |
| "Could not parse requested time" | Invalid time format | Have lead repeat the time clearly |

---

## Future Enhancements

*Planned for future versions:*
- Confirmation SMS via Twilio
- Appointment rescheduling (`reschedule_appointment`)
- Appointment cancellation (`cancel_appointment`)
