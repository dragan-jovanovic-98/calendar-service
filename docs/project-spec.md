# Project Specification: Google Calendar Availability for Retell AI

## Product Requirements

### Who Is This For?
- **Primary users**: Mortgage brokers, real estate agents, and professionals who use Retell AI voice agents to handle calls
- **End users**: Customers/leads who are being called and want to schedule appointments

### What Problem Does It Solve?
- Automates calendar availability checking during live AI voice calls
- Eliminates back-and-forth scheduling by providing real-time availability
- Allows professionals to focus on their work while AI handles appointment scheduling

### What Should It Do?

#### Core Feature: Check Availability
**Trigger**: Retell AI calls webhook with tool `check_availability`

**Input** (from Retell webhook):
```json
{
  "name": "check_availability",
  "args": {
    "requested_time_string": "Tuesday at 2pm"  // optional, natural language
  },
  "call": {
    "metadata": {
      "client_id": "uuid-here",
      "lead_id": "uuid-here",
      "campaign_id": "uuid-here"
    },
    "from_number": "+1234567890",
    "to_number": "+0987654321"
  }
}
```

**Behavior**:
1. Look up client settings from Supabase (timezone, meeting lengths, calendar ID)
2. If `requested_time_string` provided:
   - Parse natural language to datetime in customer's timezone
   - Convert to client's timezone for Google Calendar API
   - Check if that specific slot is available
3. If no specific time or unavailable:
   - Search next 3 days for availability
   - Always include options after the weekend
   - Check within preferred hours: 9am - 8pm
   - Return alternatives in chunks matching client's meeting lengths

**Output**:
```json
{
  "available": true,
  "requestedTime": "Tuesday, Jan 28 at 2:00 PM",
  "alternatives": null
}
```
```json
{
  "available": false,
  "requestedTime": "Tuesday, Jan 28 at 2:00 PM",
  "alternatives": [
    "Tuesday at 3:00 PM",
    "Tuesday at 4:30 PM",
    "Wednesday at 10:00 AM"
  ]
}
```

#### Optional Feature: Book Appointment (V2)
- Client can enable/disable booking capability
- If enabled, Retell can call `book_appointment` tool
- Creates calendar event with customer details

### User Flows

#### Client Onboarding (Dashboard)
1. Client visits dashboard and clicks "Connect Google Calendar"
2. OAuth flow redirects to Google consent screen
3. Client authorizes calendar access
4. Tokens stored encrypted in Supabase
5. Client configures: timezone, meeting lengths, business hours

#### Customer Call (Retell AI)
1. AI agent asks about scheduling
2. Customer says "I'm free Tuesday at 2pm"
3. Retell sends webhook to our service
4. Service checks client's Google Calendar
5. Returns availability instantly
6. AI agent responds with confirmation or alternatives

---

## Engineering Requirements

### Tech Stack
| Component | Choice | Reason |
|-----------|--------|--------|
| Language | TypeScript | Type safety, good Google API support |
| Framework | Fastify | Fastest Node.js framework for webhooks |
| Database | Supabase (PostgreSQL) | Client data, OAuth tokens, settings |
| Calendar | Google Calendar API | Industry standard |
| Hosting | TBD | Vercel, Railway, or similar |

### Data Schema (Supabase)

#### `clients` table
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key, matches client_id in Retell metadata |
| email | text | Client email |
| timezone | text | Client's timezone (e.g., "America/Toronto") |
| meeting_lengths | int[] | Available meeting durations in minutes [15, 30, 60] |
| business_hours_start | time | Default 09:00 |
| business_hours_end | time | Default 20:00 |
| google_calendar_id | text | Calendar to check (usually "primary") |
| booking_enabled | boolean | Whether AI can book appointments |
| created_at | timestamp | |

#### `oauth_tokens` table
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| client_id | uuid | Foreign key to clients |
| access_token | text | Encrypted Google access token |
| refresh_token | text | Encrypted Google refresh token |
| expires_at | timestamp | Token expiration time |
| created_at | timestamp | |
| updated_at | timestamp | |

### API Endpoints

#### `POST /webhook/retell`
Main webhook endpoint for Retell AI tool calls.

**Headers**: Retell authentication (TBD)

**Handles**:
- `check_availability` - Check calendar and return availability
- `book_appointment` - Book a slot (V2, if client has enabled)

#### `GET /auth/google`
Initiates OAuth flow for client calendar connection.

#### `GET /auth/google/callback`
Handles OAuth callback, stores tokens in Supabase.

### Date Parsing Logic

**Input examples → Parsed result** (assuming customer timezone America/New_York, current date Mon Jan 27, 2025):

| Input | Parsed |
|-------|--------|
| "Tuesday at 2pm" | Tue Jan 28, 14:00 EST |
| "Today after 4pm" | Mon Jan 27, 16:00+ EST |
| "Wednesday" | Wed Jan 29, check all slots 9am-8pm |
| "Tomorrow morning" | Tue Jan 28, 09:00-12:00 EST |
| "Next week" | Mon Feb 3 onwards |
| (empty - earliest) | Next 3 days + after weekend |

Parsed times converted to RFC3339 for Google Calendar API.

### Timezone Handling
- **Customer timezone**: Inferred from phone number area code or stored lead data
- **Client timezone**: Stored in Supabase `clients.timezone`
- **Display**: Always show times to customer in their timezone
- **API calls**: Convert to UTC/RFC3339 for Google Calendar API

---

## Milestones

### V1: MVP - Availability Checking
- [ ] Fastify server with webhook endpoint
- [ ] Supabase integration for client data
- [ ] Google OAuth flow for calendar connection
- [ ] Natural language date parsing
- [ ] Google Calendar availability checking
- [ ] Webhook response with availability + alternatives

### V2: Booking & Polish
- [ ] Book appointment functionality
- [ ] Buffer time between meetings (configurable)
- [ ] Multiple calendar support
- [ ] Webhook signature verification
- [ ] Rate limiting
- [ ] Monitoring/alerting

### V3: Advanced Features
- [ ] Recurring availability patterns
- [ ] Waitlist for busy slots
- [ ] Rescheduling/cancellation
- [ ] Analytics dashboard
