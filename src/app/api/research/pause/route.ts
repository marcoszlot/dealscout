import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { project_id } = await request.json();
    if (!project_id) {
      return NextResponse.json({ error: 'Missing project_id' }, { status: 400 });
    }

    const supabase = createServiceClient();
    await supabase
      .from('projects')
      .update({ status: 'paused' })
      .eq('id', project_id);

    // Reset any currently "searching" companies back to pending
    await supabase
      .from('companies')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('project_id', project_id)
      .eq('status', 'searching');

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error pausing:', error);
    return NextResponse.json({ error: 'Failed to pause' }, { status: 500 });
  }
}
