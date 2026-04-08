import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { processBatch } from '@/lib/research-worker';

export const maxDuration = 60; // Vercel Hobby max

const BATCH_SIZE = 10;

/**
 * Research Orchestrator
 *
 * Gets all pending companies, splits into batches of 10,
 * and processes them directly (no HTTP calls between functions).
 *
 * On Vercel Hobby (60s max), this handles up to ~10 companies per run.
 * For larger lists, the frontend can re-trigger for remaining pending companies.
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

    const totalSubagents = batches.length;
    console.log(
      `[DealScout] Processing ${companies.length} companies in ${totalSubagents} batch(es) (${BATCH_SIZE} per batch)`
    );

    // Process batches sequentially (direct function call, no HTTP)
    const allResults = [];
    for (let i = 0; i < batches.length; i++) {
      // Check if paused between batches
      const { data: project } = await supabase
        .from('projects')
        .select('status')
        .eq('id', project_id)
        .single();

      if (project?.status === 'paused') {
        console.log(`[DealScout] Paused after batch ${i}`);
        break;
      }

      console.log(`[DealScout] Starting batch ${i + 1}/${totalSubagents} (${batches[i].length} companies)`);

      try {
        const result = await processBatch(batches[i], project_id);
        console.log(`[DealScout] Batch ${i + 1} done:`, result);
        allResults.push({ batch: i + 1, ...result });
      } catch (err: any) {
        console.error(`[DealScout] Batch ${i + 1} failed:`, err?.message || err);
        allResults.push({ batch: i + 1, error: err?.message });
      }
    }

    // Mark project complete if still running
    const { data: finalProject } = await supabase
      .from('projects')
      .select('status')
      .eq('id', project_id)
      .single();

    if (finalProject?.status === 'running') {
      // Check if there are still pending companies (function might have timed out)
      const { count: pendingCount } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project_id)
        .eq('status', 'pending');

      if (pendingCount === 0) {
        await supabase
          .from('projects')
          .update({ status: 'completed' })
          .eq('id', project_id);
      }
    }

    return NextResponse.json({
      ok: true,
      total_companies: companies.length,
      batches_processed: allResults.length,
      results: allResults,
    });
  } catch (error: any) {
    console.error('Error starting research:', error);
    return NextResponse.json({ error: 'Failed to start research' }, { status: 500 });
  }
}
