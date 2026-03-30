import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 300; // 5 min for Vercel

export async function POST(request: NextRequest) {
  try {
    const { project_id } = await request.json();
    if (!project_id) {
      return NextResponse.json({ error: 'Missing project_id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Update project status
    await supabase
      .from('projects')
      .update({ status: 'running' })
      .eq('id', project_id);

    // Get pending companies
    const { data: companies, error } = await supabase
      .from('companies')
      .select('*')
      .eq('project_id', project_id)
      .eq('status', 'pending')
      .order('created_at');

    if (error) throw error;
    if (!companies?.length) {
      await supabase
        .from('projects')
        .update({ status: 'completed' })
        .eq('id', project_id);
      return NextResponse.json({ ok: true, message: 'No pending companies' });
    }

    // Process in batches of 3
    const BATCH_SIZE = 3;
    const DELAY_MS = 1500;

    for (let i = 0; i < companies.length; i += BATCH_SIZE) {
      // Check if paused
      const { data: project } = await supabase
        .from('projects')
        .select('status')
        .eq('id', project_id)
        .single();

      if (project?.status === 'paused') break;

      const batch = companies.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      await Promise.allSettled(
        batch.map(async (company) => {
          try {
            await fetch(new URL('/api/research/company', request.url).toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ company_id: company.id }),
            });
          } catch (err) {
            console.error(`Failed to research ${company.company_name}:`, err);
          }
        })
      );

      // Update project progress
      const { count: completed } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project_id)
        .in('status', ['found', 'escalation', 'error']);

      const { count: found } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project_id)
        .eq('status', 'found');

      const { count: escalation } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project_id)
        .eq('status', 'escalation');

      await supabase
        .from('projects')
        .update({ completed: completed || 0, found: found || 0, escalation: escalation || 0 })
        .eq('id', project_id);

      // Delay between batches
      if (i + BATCH_SIZE < companies.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    // Check if all done
    const { data: finalProject } = await supabase
      .from('projects')
      .select('status')
      .eq('id', project_id)
      .single();

    if (finalProject?.status === 'running') {
      await supabase
        .from('projects')
        .update({ status: 'completed' })
        .eq('id', project_id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error starting research:', error);
    return NextResponse.json({ error: 'Failed to start research' }, { status: 500 });
  }
}
