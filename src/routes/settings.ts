import type { FastifyInstance } from 'fastify';
import { supabase, getClientById } from '../lib/supabase.js';

interface AvailabilityRule {
  days: number[];  // [0-6] where 0=Sunday, 1=Monday, etc.
  start: string;   // "09:00"
  end: string;     // "17:00"
}

interface Vacation {
  start: string;  // "2025-03-01"
  end: string;    // "2025-03-15"
}

interface ClientSettings {
  // Call settings
  meeting_length?: number;
  business_hours?: {
    rules: AvailabilityRule[];
  };
  excluded_dates?: string[];  // ["2025-01-30", "2025-02-14"]
  holidays?: string[];        // ["12-25", "01-01"] MM-DD format
  vacations?: Vacation[];
  // Profile
  broker_first_name?: string;
  broker_last_name?: string;
  business_phone?: string;
  primary_email?: string;
  personal_phone?: string;
  billing_email?: string;
  timezone?: string;
}

export async function settingsRoutes(server: FastifyInstance) {
  // Get client settings
  // GET /settings?client_id=uuid
  server.get<{
    Querystring: { client_id: string };
  }>('/settings', async (request, reply) => {
    const { client_id } = request.query;

    if (!client_id) {
      return reply.status(400).send({ error: 'client_id is required' });
    }

    const { data, error } = await supabase
      .from('mortgage_clients')
      .select(`
        id,
        company_name,
        timezone,
        meeting_length,
        business_hours,
        excluded_dates,
        holidays,
        vacations,
        broker_first_name,
        broker_last_name,
        business_phone,
        primary_email,
        personal_phone,
        billing_email
      `)
      .eq('id', client_id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    return data;
  });

  // Update client settings
  // PATCH /settings { client_id, ...fields }
  server.patch<{
    Body: { client_id: string } & ClientSettings;
  }>('/settings', async (request, reply) => {
    const { client_id, ...settings } = request.body;

    if (!client_id) {
      return reply.status(400).send({ error: 'client_id is required' });
    }

    // Verify client exists
    const client = await getClientById(client_id);
    if (!client) {
      return reply.status(404).send({ error: 'Client not found' });
    }

    // Filter out undefined values
    const updates: Record<string, unknown> = {};
    const allowedFields = [
      'meeting_length',
      'business_hours',
      'excluded_dates',
      'holidays',
      'vacations',
      'broker_first_name',
      'broker_last_name',
      'business_phone',
      'primary_email',
      'personal_phone',
      'billing_email',
      'timezone',
    ];

    for (const field of allowedFields) {
      if (settings[field as keyof ClientSettings] !== undefined) {
        updates[field] = settings[field as keyof ClientSettings];
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' });
    }

    const { error } = await supabase
      .from('mortgage_clients')
      .update(updates)
      .eq('id', client_id);

    if (error) {
      console.error('Error updating settings:', error);
      return reply.status(500).send({ error: 'Failed to update settings' });
    }

    return { success: true, updated: Object.keys(updates) };
  });
}
