/**
 * Research Worker — core batch processing logic
 *
 * Extracted so it can be called directly (not via HTTP),
 * which is more reliable on Vercel's serverless platform.
 */

import { createServiceClient } from '@/lib/supabase';
import { searchWithFallback } from '@/lib/apify';
import { selectBestContact } from '@/lib/contact-scorer';

const DELAY_BETWEEN_COMPANIES_MS = 1000;

export interface BatchResult {
  processed: number;
  found: number;
  escalation: number;
  errors: number;
}

/**
 * Process a batch of companies: Apify search → algorithmic scoring → save to Supabase.
 * Zero AI tokens consumed.
 */
export async function processBatch(
  companyIds: string[],
  projectId: string,
): Promise<BatchResult> {
  const supabase = createServiceClient();
  const results: BatchResult = { processed: 0, found: 0, escalation: 0, errors: 0 };

  for (let i = 0; i < companyIds.length; i++) {
    const companyId = companyIds[i];

    // Check if project was paused
    const { data: project } = await supabase
      .from('projects')
      .select('status')
      .eq('id', projectId)
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
      console.error(`Worker error for ${company.company_name}:`, err?.message || err);

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
    await updateProjectProgress(supabase, projectId);

    // Delay between companies to respect rate limits
    if (i < companyIds.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_COMPANIES_MS));
    }
  }

  return results;
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
