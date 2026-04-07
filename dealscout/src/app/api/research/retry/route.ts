import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { company_id } = await request.json();
    if (!company_id) {
      return NextResponse.json({ error: 'Missing company_id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Reset to pending
    await supabase
      .from('companies')
      .update({
        status: 'pending',
        contact_name: null,
        contact_title: null,
        contact_linkedin: null,
        hierarchy_level: null,
        notes: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', company_id);

    // Trigger research
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', company_id)
      .single();

    if (company) {
      // Fire and forget
      fetch(new URL('/api/research/company', request.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id }),
      }).catch(console.error);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error retrying:', error);
    return NextResponse.json({ error: 'Failed to retry' }, { status: 500 });
  }
}
