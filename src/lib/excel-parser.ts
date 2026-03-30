import * as XLSX from 'xlsx';
import { ParsedCompany } from './types';

function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
    let nonEmpty = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && String(cell.v).trim() !== '') {
        nonEmpty++;
      }
    }
    if (nonEmpty >= 2) return r;
  }
  return 0;
}

function matchColumn(headers: string[], ...patterns: string[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex(h =>
      h.toLowerCase().includes(pattern.toLowerCase())
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseStrategicSheet(sheet: XLSX.WorkSheet): ParsedCompany[] {
  const headerRow = findHeaderRow(sheet);
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown[][];
  if (!data || data.length <= headerRow + 1) return [];

  const headers = (data[headerRow] as unknown[]).map(h => String(h || '').trim());

  const colTier = matchColumn(headers, 'tier');
  const colName = matchColumn(headers, 'buyer name', 'company name', 'company', 'name');
  const colHQ = matchColumn(headers, 'hq', 'headquarters', 'location');
  const colSegment = matchColumn(headers, 'segment', 'sector', 'industry');
  const colMA = matchColumn(headers, 'm&a', 'track record', 'acquisition');
  const colWebsite = matchColumn(headers, 'website', 'url', 'domain');

  const companies: ParsedCompany[] = [];

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row || row.every(cell => !cell || String(cell).trim() === '')) continue;

    const companyName = colName >= 0 ? String(row[colName] || '').trim() : '';
    if (!companyName) continue;

    companies.push({
      company_name: companyName,
      buyer_type: 'Strategic',
      tier: colTier >= 0 ? String(row[colTier] || '').trim() || undefined : undefined,
      hq: colHQ >= 0 ? String(row[colHQ] || '').trim() || undefined : undefined,
      website: colWebsite >= 0 ? String(row[colWebsite] || '').trim() || undefined : undefined,
      segment: colSegment >= 0 ? String(row[colSegment] || '').trim() || undefined : undefined,
      ma_track_record: colMA >= 0 ? String(row[colMA] || '').trim() || undefined : undefined,
    });
  }

  return companies;
}

function parseFinancialSheet(sheet: XLSX.WorkSheet): ParsedCompany[] {
  const headerRow = findHeaderRow(sheet);
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 }) as unknown[][];
  if (!data || data.length <= headerRow + 1) return [];

  const headers = (data[headerRow] as unknown[]).map(h => String(h || '').trim());

  const colName = matchColumn(headers, 'fund', 'firm', 'name', 'buyer');
  const colHQ = matchColumn(headers, 'hq', 'headquarters', 'location');
  const colPortfolio = matchColumn(headers, 'portfolio', 'relevant portfolio');
  const colDeal = matchColumn(headers, 'deal structure', 'deal preference');
  const colEBITDA = matchColumn(headers, 'ebitda');
  const colRevenue = matchColumn(headers, 'revenue');
  const colWebsite = matchColumn(headers, 'website', 'url', 'domain');

  const companies: ParsedCompany[] = [];

  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i] as unknown[];
    if (!row || row.every(cell => !cell || String(cell).trim() === '')) continue;

    const companyName = colName >= 0 ? String(row[colName] || '').trim() : '';
    if (!companyName) continue;

    companies.push({
      company_name: companyName,
      buyer_type: 'PE',
      hq: colHQ >= 0 ? String(row[colHQ] || '').trim() || undefined : undefined,
      website: colWebsite >= 0 ? String(row[colWebsite] || '').trim() || undefined : undefined,
      portfolio_companies: colPortfolio >= 0 ? String(row[colPortfolio] || '').trim() || undefined : undefined,
      deal_structure: colDeal >= 0 ? String(row[colDeal] || '').trim() || undefined : undefined,
      ebitda_target: colEBITDA >= 0 ? String(row[colEBITDA] || '').trim() || undefined : undefined,
      revenue_target: colRevenue >= 0 ? String(row[colRevenue] || '').trim() || undefined : undefined,
    });
  }

  return companies;
}

export function parseExcelBuffer(buffer: ArrayBuffer): {
  strategic: ParsedCompany[];
  financial: ParsedCompany[];
} {
  const workbook = XLSX.read(buffer, { type: 'array' });

  let strategic: ParsedCompany[] = [];
  let financial: ParsedCompany[] = [];

  for (const sheetName of workbook.SheetNames) {
    const lower = sheetName.toLowerCase();
    if (lower.includes('cover') || lower.includes('summary') || lower.includes('instructions')) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];

    if (lower.includes('financial') || lower.includes('pe') || lower.includes('fund')) {
      financial = [...financial, ...parseFinancialSheet(sheet)];
    } else if (lower.includes('strategic') || lower.includes('corporate') || lower.includes('buyer')) {
      strategic = [...strategic, ...parseStrategicSheet(sheet)];
    } else {
      // Try to detect based on content - default to strategic
      strategic = [...strategic, ...parseStrategicSheet(sheet)];
    }
  }

  return { strategic, financial };
}
