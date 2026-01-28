import { supabase, getClientById } from '../lib/supabase.js';
export async function settingsRoutes(server) {
    // Get client settings
    // GET /settings?client_id=uuid
    server.get('/settings', async (request, reply) => {
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
    server.patch('/settings', async (request, reply) => {
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
        const updates = {};
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
            if (settings[field] !== undefined) {
                updates[field] = settings[field];
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
//# sourceMappingURL=settings.js.map