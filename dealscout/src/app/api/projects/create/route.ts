import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { ParsedCompany } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { name, companies } = await request.json() as {
      name: string;
      companies: ParsedCompany[];
    };

    if (!name || !companies?.length) {
      return NextResponse.json({ error: 'Missing name or companies' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Create project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        name,
        total_companies: companies.length,
        status: 'draft',
      })
      .select()
      .single();

    if (projectError) throw projectError;

    // Insert companies
    const companyRows = companies.map(c => ({
      project_id: project.id,
      company_name: c.company_name,
      buyer_type: c.buyer_type,
      tier: c.tier || null,
      hq: c.hq || null,
      website: c.website || null,
      segment: c.segment || null,
      ma_track_record: c.ma_track_record || null,
      portfolio_companies: c.portfolio_companies || null,
      deal_structure: c.deal_structure || null,
      ebitda_target: c.ebitda_target || null,
      revenue_target: c.revenue_target || null,
      status: 'pending',
    }));

    // Insert in batches of 50
    for (let i = 0; i < companyRows.length; i += 50) {
      const batch = companyRows.slice(i, i + 50);
      const { error } = await supabase.from('companies').insert(batch);
      if (error) throw error;
    }

    return NextResponse.json({ project_id: project.id });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
