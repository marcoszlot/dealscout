import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { searchWithFallback } from '@/lib/apify';
import { selectBestContact } from '@/lib/contact-scorer';

export const maxDuration = 300; // 5 min — handles up to 10 companies

const DELAY_BETWEEN_COMPANIES_MS = 1000; // respect Apify rate limits

/**
 * Batch Worker ("Subagent")
 *
 * Processes up to 10 companies sequentially within a single request.
 * The /api/research/start route deploys ceil(total/10) of these in parallel.
 *
 * POST body: { company_ids: string[], project_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  try {
    const { company_ids, project_id } = await request.json();

    if (!company_ids?.length || !project_id) {
      return NextResponse.json(
        { error: 'Missing company_ids or project_id' },
        { status: 400 },
      );
    }

    const results = { processed: 0, found: 0, escalation: 0, errors: 0 };

    for (const companyId of company_ids) {
      // Check if project was paused
      const { data: project } = await supabase
        .from('projects')
        .select('status')
        .eq('id', project_id)
        .single();

      if (project?.status === 'paused') break;

      // Get company details
      const { data: company, error: fetchError } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();

      if (fetchError || !company) {
        results.errors++;
        continue;
      }

      // Mark as searching
      await supabase
        .from('companies')
        .update({ status: 'searching', updated_at: new Date().toISOString() })
        .eq('id', companyId);

      try {
        // Search LinkedIn via Apify (with fallback rounds)
        const linkedInResults = await searchWithFallback(
          company.company_name,
          company.buyer_type as 'PE' | 'Strategic',
        );

        // Score results algorithmically — zero AI tokens
        const contact = selectBestContact(
          linkedInResults,
          company.company_name,
          company.buyer_type as 'PE' | 'Strategic',
        );

        // Save result
        await supabase
          .from('companies')
          .update({
            contact_name: contact.name || null,
            contact_title: contact.title || null,
            contact_linkedin: contact.linkedin || null,
            hierarchy_level: contact.level || null,
            notes: contact.notes || null,
            status: contact.status,
            search_attempts: (company.search_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', companyId);

        results.processed++;
        if (contact.status === 'found') results.found++;
        if (contact.status === 'escalation') results.escalation++;
      } catch (err: any) {
        console.error(`Batch worker error for ${company.company_name}:`, err);

        await supabase
          .from('companies')
          .update({
            status: 'error',
            notes: `Error: ${err?.message || 'Unknown error'}`,
            search_attempts: (company.search_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', companyId);

        results.errors++;
      }

      // Update project progress after each company
      await updateProjectProgress(supabase, project_id);

      // Delay between companies to respect rate limits
      if (company_ids.indexOf(companyId) < company_ids.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_COMPANIES_MS));
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    console.error('Batch worker error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Update the project's aggregate progress counters.
 */
async function updateProjectProgress(supabase: any, projectId: string) {
  const [
    { count: completed },
    { count: found },
    { count: escalation },
  ] = await Promise.all([
    supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .in('status', ['found', 'escalation', 'error']),
    supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'found'),
    supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'escalation'),
  ]);

  await supabase
    .from('projects')
    .update({
      completed: completed || 0,
      found: found || 0,
      escalation: escalation || 0,
    })
    .eq('id', projectId);
}
