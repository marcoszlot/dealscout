import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { company_id, contact_name, contact_title, contact_linkedin, notes, status } =
      await request.json();

    if (!company_id) {
      return NextResponse.json({ error: 'Missing company_id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (contact_name !== undefined) updates.contact_name = contact_name;
    if (contact_title !== undefined) updates.contact_title = contact_title;
    if (contact_linkedin !== undefined) updates.contact_linkedin = contact_linkedin;
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;

    const { error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', company_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error updating company:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
