import { NextRequest, NextResponse } from 'next/server';
import { processBatch } from '@/lib/research-worker';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 60;

/**
 * Single Company Research (used by retry flow)
 * Delegates to the shared research worker.
 */
export async function POST(request: NextRequest) {
  try {
    const { company_id } = await request.json();
    if (!company_id) {
      return NextResponse.json({ error: 'Missing company_id' }, { status: 400 });
    }

    // Get the project_id for this company
    const supabase = createServiceClient();
    const { data: company } = await supabase
      .from('companies')
      .select('project_id')
      .eq('id', company_id)
      .single();

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const result = await processBatch([company_id], company.project_id);

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('Research error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
