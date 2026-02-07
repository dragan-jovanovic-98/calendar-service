# System Architecture

## Overview

```
┌─────────────────┐     Webhook      ┌──────────────────────┐
│   Retell AI     │ ───────────────► │   Calendar Service   │
│  (Voice Agent)  │ ◄─────────────── │   (Digital Ocean)    │
└─────────────────┘     Response     └──────────┬───────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
          ┌─────────────────┐        ┌─────────────────┐         ┌─────────────────┐
          │  Google Calendar │        │    Supabase     │         │     Twilio      │
          │       API        │        │  (PostgreSQL)   │         │   (SMS API)     │
          └─────────────────┘        └─────────────────┘         └─────────────────┘
                                              ▲
                                              │
                                     ┌─────────────────┐
                                     │ Client Dashboard │
                                     │ (Supabase Auth)  │
                                     └─────────────────┘
```

## Components

### 1. Calendar Service (This Project)
**Location**: Digital Ocean server (long-running Node.js process)
**Framework**: Fastify + TypeScript

**Responsibilities**:
- Receive and process Retell AI webhooks
- Parse natural language dates
- Query Google Calendar for availability
- Return formatted responses to Retell
- Handle OAuth token refresh
- Send fallback SMS via Twilio when needed

### 2. Supabase
**Role**: Primary data store and authentication

**Tables**:
- `clients` - Client profiles and settings
- `oauth_tokens` - Encrypted Google OAuth tokens
- `failure_logs` - All system failures for debugging
- `pending_sync` - Temporary storage when Supabase is unreachable

**Auth**: Email/password via Supabase Auth for client dashboard

### 3. Client Dashboard (External)
**Auth**: Supabase Auth (email/password)
**Purpose**: Client self-service portal

**Features**:
- Google Calendar OAuth connection
- Profile settings (email, billing email, business phone, personal phone)
- Timezone and meeting length configuration
- Enable/disable booking capability

### 4. External Services
| Service | Purpose |
|---------|---------|
| Google Calendar API | Check availability, create events |
| Twilio API | Send fallback SMS to broker's business phone |
| Retell AI | Voice agent webhook source |

---

## Data Flow

### Check Availability Flow

```
1. Retell AI sends webhook
         │
         ▼
2. Validate request, extract client_id
         │
         ▼
3. Fetch client settings from Supabase
   (timezone, meeting_lengths, calendar_id)
         │
         ▼
4. Parse requested_time_string (if provided)
   Convert to client timezone → RFC3339
         │
         ▼
5. Fetch OAuth tokens from Supabase
   Refresh if expired
         │
         ▼
6. Query Google Calendar API
   GET /calendars/{id}/freeBusy
         │
         ▼
7. Process availability
   - Check requested slot
   - Find alternatives if unavailable
   - Format in customer's timezone
         │
         ▼
8. Return webhook response
   {available, requestedTime, alternatives}
```

### Fallback SMS Flow (When Booking Fails)

```
1. Booking attempt fails (API error, timeout)
         │
         ▼
2. Log failure to Supabase `failure_logs`
         │
         ▼
3. Return confirmation to Retell:
   "Your call is set for [Requested Time]"
         │
         ▼
4. Send SMS via Twilio to broker's business_phone:
   "Manual booking needed: [Customer] requested [Time]
    Phone: [Customer Phone] | Lead ID: [lead_id]"
```

---

## Data Schema

### `clients` table
```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  billing_email TEXT,
  business_phone TEXT,
  personal_phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  meeting_lengths INT[] DEFAULT '{30}',
  business_hours_start TIME DEFAULT '09:00',
  business_hours_end TIME DEFAULT '20:00',
  google_calendar_id TEXT DEFAULT 'primary',
  booking_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `oauth_tokens` table
```sql
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id)
);
```

### `failure_logs` table
```sql
CREATE TABLE failure_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  error_type TEXT NOT NULL,  -- 'google_api', 'oauth_refresh', 'supabase', 'twilio'
  error_message TEXT,
  request_payload JSONB,
  retry_count INT DEFAULT 0,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `pending_sync` table (Local SQLite Fallback)
```sql
-- Stored locally on Digital Ocean when Supabase unreachable
CREATE TABLE pending_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- 'insert', 'update'
  payload JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Error Handling & Resilience

### Retry Strategy

| Error Type | Strategy |
|------------|----------|
| Google API rate limit | Exponential backoff: 1s, 2s, 4s (max 3 attempts) |
| OAuth token refresh | Immediate retry once, then log + notify |
| Supabase unreachable | Store in local SQLite, sync on reconnect |
| Twilio SMS failure | Log to failure_logs, retry on next cycle |

### Supabase Fallback

When Supabase is unreachable:
1. Store critical data in local SQLite (`pending_sync` table)
2. Background job checks Supabase connectivity every 30 seconds
3. When reconnected, replay pending operations in order
4. Clear `pending_sync` after successful sync

### Notification Triggers

| Event | Action |
|-------|--------|
| OAuth refresh fails after retry | Email client at `email` |
| 3+ consecutive Google API failures | Alert system admin |
| Supabase down > 5 minutes | Alert system admin |

---

## Security

### OAuth Token Encryption
- Tokens encrypted at rest using AES-256-GCM
- Encryption key stored in environment variable
- Decrypted only when making API calls

### Webhook Validation
- Validate Retell webhook signatures (if provided)
- Reject requests without valid `client_id` in metadata
- Rate limit by client_id: 100 requests/minute

### Supabase Row-Level Security
```sql
-- Clients can only access their own data
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view own profile"
  ON clients FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Clients can update own profile"
  ON clients FOR UPDATE
  USING (auth.uid() = id);
```

---

## Deployment (Digital Ocean)

### Server Details
- **IP**: 138.68.232.89
- **Domain**: calendar.courtside-ai.com
- **Droplet**: 1 vCPU, 512MB RAM, 10GB SSD (SFO2)
- **OS**: Ubuntu
- **SSH**: `ssh root@138.68.232.89`

### File Structure
```
/var/www/calendar-service/        # Project root
├── dist/                         # Compiled JS (committed to git)
│   ├── index.js                  # PM2 entrypoint
│   ├── routes/
│   ├── lib/
│   └── config/
├── src/                          # TypeScript source
├── .env                          # Environment variables
├── package.json
└── node_modules/
```

### Process Manager: PM2
```bash
pm2 list                          # Show running processes
pm2 show 0                        # Show calendar-service details
pm2 restart calendar-service      # Restart after deploy
pm2 logs calendar-service         # View logs
pm2 logs calendar-service --lines 100  # Last 100 lines
```

- **App name**: `calendar-service` (id: 0)
- **Script**: `/var/www/calendar-service/dist/index.js`
- **Working dir**: `/var/www/calendar-service`

### Nginx + SSL
- **Config file**: `/etc/nginx/sites-enabled/calendar-service`
- **SSL**: Let's Encrypt (Certbot auto-managed)
- **Proxy**: Port 80/443 → localhost:3000
- HTTP automatically redirects to HTTPS

### Deploy Process
```bash
ssh root@138.68.232.89
cd /var/www/calendar-service
git pull origin main
pm2 restart calendar-service
```

Note: `dist/` is committed to git, so no need to run `npm run build` on the server. Just pull and restart.

### Environment Variables
```bash
# Server
PORT=3000
NODE_ENV=production

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx  # Service key for server-side operations

# Google OAuth
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://calendar.courtside-ai.com/auth/google/callback

# Security
ENCRYPTION_KEY=xxx  # 32-byte key for token encryption
```

### Health Checks
- `GET /health` - Basic server health
- `GET /health/supabase` - Supabase connectivity
- `GET /health/google` - Google API reachability

---

## Performance Considerations

### Caching
- Cache client settings in memory (5-minute TTL)
- Cache OAuth tokens until 5 minutes before expiry
- Use connection pooling for Supabase

### Webhook Response Time
- Target: < 500ms response time
- Critical path: Supabase lookup → Google API → Response
- Parse dates locally (no external AI call for simple patterns)

### When to Use n8n (via MCP)
Only for complex date parsing that local parser can't handle:
- "Third Tuesday of next month"
- "Sometime next week when I'm back from vacation"
- Ambiguous multi-part requests
