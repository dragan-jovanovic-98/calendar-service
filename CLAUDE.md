# Google Calendar Availability Checker for Retell AI

## What This Project Does
A webhook service that Retell AI voice agents call to check Google Calendar availability for clients (mortgage brokers, real estate agents, professionals). Each client connects their own Google Calendar via OAuth.

**Flow:**
1. Retell AI sends webhook request with natural language time (e.g., "Tuesday at 2pm", "today after 4pm")
2. Service looks up client timezone from Supabase
3. Parses natural language into Google Calendar API format
4. Checks availability in chunks matching client's meeting lengths
5. Returns immediate webhook response with availability + alternatives

## Tech Stack
- **Language**: TypeScript
- **Framework**: Fastify (chosen for webhook speed)
- **Database**: Supabase (client data, OAuth tokens, timezones, meeting lengths)
- **APIs**: Google Calendar API, Retell AI webhooks
- **Optional**: n8n via MCP for complex date extraction if needed

## Webhook Response Format
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
  "alternatives": ["Tuesday at 3:00 PM", "Tuesday at 4:30 PM", "Wednesday at 10:00 AM"]
}
```

## Key Documentation
- `docs/project-spec.md` - Product & engineering requirements
- `docs/architecture.md` - System design, data flow, API contracts
- `docs/project-status.md` - Milestones and current progress

## Data in Supabase
- **clients**: client_id, google_oauth_tokens (encrypted), timezone, meeting_lengths[], calendar_id
- OAuth tokens must be refreshed automatically when expired

## Date Parsing Requirements
Must handle inputs like:
- "Tuesday at 2pm" → next Tuesday 14:00 in client timezone
- "Today after 4pm" → today 16:00+ in client timezone
- "Wednesday" → next Wednesday, check all available slots
- "Tomorrow morning" → tomorrow 09:00-12:00 in client timezone

Convert parsed times to RFC3339 format for Google Calendar API.

## Constraints & Rules

### Performance
- Webhook responses must be fast - minimize external calls
- Cache client timezone/meeting length data when possible
- Use connection pooling for Supabase

### Security
- Never commit secrets - use environment variables
- Store OAuth tokens encrypted
- Validate incoming Retell webhook requests
- Refresh Google OAuth tokens before they expire

### Code Quality
- TypeScript strict mode
- Handle all errors explicitly with meaningful messages
- Log webhook requests for debugging (without sensitive data)

### Git Workflow
- Never push directly to main
- Feature branches for new work
- Descriptive commit messages

## Commands
```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run test     # Run tests
```

## Environment Variables
See `.env.example` for required variables:
- Supabase connection
- Retell webhook secret (if applicable)
