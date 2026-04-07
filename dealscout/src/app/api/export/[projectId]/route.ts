import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createServiceClient } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const supabase = createServiceClient();

    const { data: companies, error } = await supabase
      .from('companies')
      .select('*')
      .eq('project_id', params.projectId)
      .order('buyer_type')
      .order('company_name');

    if (error) throw error;
    if (!companies?.length) {
      return NextResponse.json({ error: 'No companies found' }, { status: 404 });
    }

    // Sheet 1: Contact Research
    const researchData = companies.map(c => ({
      'Company Name': c.company_name,
      'Buyer Type': c.buyer_type,
      'Tier': c.tier || '',
      'Contact Full Name': c.contact_name || '',
      'Job Title': c.contact_title || '',
      'Hierarchy Level': c.hierarchy_level || '',
      'Company Website': c.website || '',
      'LinkedIn URL': c.contact_linkedin || '',
      'Notes': c.notes || '',
      'Status': c.status,
    }));

    const ws1 = XLSX.utils.json_to_sheet(researchData);

    // Column widths
    ws1['!cols'] = [
      { wch: 30 }, // Company Name
      { wch: 12 }, // Buyer Type
      { wch: 6 },  // Tier
      { wch: 25 }, // Contact Full Name
      { wch: 35 }, // Job Title
      { wch: 15 }, // Hierarchy Level
      { wch: 30 }, // Company Website
      { wch: 40 }, // LinkedIn URL
      { wch: 50 }, // Notes
      { wch: 12 }, // Status
    ];

    // Sheet 2: Import File (only found contacts)
    const foundCompanies = companies.filter(c => c.status === 'found' && c.contact_name);
    const importData = foundCompanies.map(c => {
      const nameParts = (c.contact_name || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      let domain = c.website || '';
      domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

      return {
        'first_name': firstName,
        'last_name': lastName,
        'domain': domain,
      };
    });

    const ws2 = XLSX.utils.json_to_sheet(importData);
    ws2['!cols'] = [
      { wch: 20 },
      { wch: 25 },
      { wch: 30 },
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Contact Research');
    XLSX.utils.book_append_sheet(wb, ws2, 'Import File');

    // Generate buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="dealscout-research.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
