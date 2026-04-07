import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { searchWithFallback } from '@/lib/apify';
import { selectBestContact } from '@/lib/contact-scorer';

export const maxDuration = 120;

/**
 * Single Company Research
 *
 * Researches one company using Apify LinkedIn People Search + algorithmic scoring.
 * Used by the retry flow and can be called standalone.
 * Zero AI tokens consumed.
 *
 * POST body: { company_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  try {
    const { company_id } = await request.json();
    if (!company_id) {
      return NextResponse.json({ error: 'Missing company_id' }, { status: 400 });
    }

    // Get company
    const { data: company, error: fetchError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', company_id)
      .single();

    if (fetchError || !company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    // Mark as searching
    await supabase
      .from('companies')
      .update({ status: 'searching', updated_at: new Date().toISOString() })
      .eq('id', company_id);

    try {
      // Search LinkedIn via Apify (with fallback rounds)
      const linkedInResults = await searchWithFallback(
        company.company_name,
        company.buyer_type as 'PE' | 'Strategic',
      );

      // Score results algorithmically
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
        .eq('id', company_id);

      return NextResponse.json({ ok: true, status: contact.status });
    } catch (err: any) {
      console.error(`Research error for ${company.company_name}:`, err);

      // Save error
      await supabase
        .from('companies')
        .update({
          status: 'error',
          notes: `Error: ${err?.message || 'Unknown error'}`,
          search_attempts: (company.search_attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', company_id);

      return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Research error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
