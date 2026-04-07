import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 300; // 5 min for Vercel

const BATCH_SIZE = 10; // each subagent handles up to 10 companies

/**
 * Research Orchestrator
 *
 * Splits pending companies into batches of 10 and deploys
 * ceil(total/10) parallel "subagent" workers.
 *
 * Architecture:
 *   start (this route)
 *     ├── batch worker #1  (companies 1-10)
 *     ├── batch worker #2  (companies 11-20)
 *     ├── batch worker #3  (companies 21-30)
 *     └── ...
 *
 * Each batch worker calls Apify + algorithmic scorer.
 * Zero AI tokens consumed.
 */
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
      .select('id')
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

    // Split into batches of BATCH_SIZE
    const batches: string[][] = [];
    for (let i = 0; i < companies.length; i += BATCH_SIZE) {
      batches.push(
        companies.slice(i, i + BATCH_SIZE).map(c => c.id)
      );
    }

    const totalSubagents = batches.length; // = Math.ceil(companies.length / BATCH_SIZE)
    console.log(
      `[DealScout] Deploying ${totalSubagents} subagent(s) for ${companies.length} companies ` +
      `(${BATCH_SIZE} per batch)`
    );

    // Deploy all subagents in parallel (fire and forget)
    const batchUrl = new URL('/api/research/batch', request.url).toString();

    const subagentPromises = batches.map((companyIds, index) =>
      fetch(batchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_ids: companyIds,
          project_id,
        }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          console.log(`[DealScout] Subagent #${index + 1} finished:`, data);
          return { index: index + 1, ok: res.ok, data };
        })
        .catch((err) => {
          console.error(`[DealScout] Subagent #${index + 1} failed:`, err);
          return { index: index + 1, ok: false, error: err.message };
        })
    );

    // Wait for all subagents to complete
    const results = await Promise.allSettled(subagentPromises);

    // Check final state and mark project complete
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

    return NextResponse.json({
      ok: true,
      total_companies: companies.length,
      subagents_deployed: totalSubagents,
      batch_size: BATCH_SIZE,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: 'rejected' }),
    });
  } catch (error: any) {
    console.error('Error starting research:', error);
    return NextResponse.json({ error: 'Failed to start research' }, { status: 500 });
  }
}
