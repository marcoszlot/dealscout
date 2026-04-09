/**
 * Apify LinkedIn Company Employees Client
 *
 * Uses harvestapi/linkedin-company-employees to search the People tab
 * of a company's LinkedIn page. This guarantees results are actual employees.
 *
 * OPTIMIZED FOR VERCEL HOBBY (60s limit):
 * - Single Apify call per company with ALL keywords at once
 * - Uses waitForFinish to skip polling overhead
 * - No fallback rounds — one fast call, scorer handles ranking
 *
 * No cookies or LinkedIn account required.
 * Pricing: ~$0.03 per company (covered by Apify free tier $5/mo)
 */

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const EMPLOYEES_ACTOR_ID = 'harvestapi~linkedin-company-employees';
const WAIT_FOR_FINISH_SECS = 45; // wait up to 45s for Apify to finish (leaves buffer for Vercel 60s limit)

export interface LinkedInPerson {
  fullName: string;
  title: string;        // headline / job title
  profileUrl: string;   // linkedin.com/in/...
  company: string;
  location: string;
}

// ─── All title keywords by buyer type (searched in ONE call) ─────────

const ALL_PE_TITLES = [
  'Vice President', 'Principal', 'Senior Associate',
  'Managing Director', 'Partner',
  'Business Development',
];

const ALL_STRATEGIC_TITLES = [
  'M&A', 'Corporate Development', 'Corp Dev',
  'Strategy', 'Business Development',
  'CFO', 'CEO',
];

// ─── Normalization helpers ──────────────────────────────────────────

function extractCompanyFromPositions(raw: Record<string, any>): string {
  for (const key of ['currentPositions', 'currentPosition', 'positions', 'experience']) {
    if (Array.isArray(raw[key]) && raw[key].length > 0) {
      return raw[key][0].companyName || raw[key][0].company || '';
    }
  }
  return '';
}

function extractTitleFromPositions(raw: Record<string, any>): string {
  for (const key of ['currentPositions', 'currentPosition', 'positions', 'experience']) {
    if (Array.isArray(raw[key]) && raw[key].length > 0) {
      return raw[key][0].title || raw[key][0].position || raw[key][0].description || '';
    }
  }
  return '';
}

function normalizeResult(raw: Record<string, any>, fallbackCompany?: string): LinkedInPerson {
  const fullName =
    raw.fullName || raw.full_name || raw.name ||
    (raw.firstName && raw.lastName
      ? `${raw.firstName} ${raw.lastName}`.trim()
      : raw.firstName || raw.lastName || '');

  // NEVER use raw.summary — that's the LinkedIn "About" bio
  const rawTitle =
    raw.headline || raw.title || raw.jobTitle || raw.job_title ||
    raw.currentJobTitle || raw.position || raw.subTitle || raw.tagline ||
    extractTitleFromPositions(raw) || '';
  const title = rawTitle.length > 200 ? '' : rawTitle;

  const profileUrl =
    raw.linkedinUrl || raw.linkedin_url || raw.linkedInUrl ||
    raw.profileUrl || raw.profile_url || raw.url || raw.profileLink ||
    (raw.publicIdentifier
      ? `https://www.linkedin.com/in/${raw.publicIdentifier}`
      : '') || '';

  const company =
    raw.company || raw.companyName || raw.company_name ||
    raw.currentCompany || raw.current_company ||
    extractCompanyFromPositions(raw) ||
    fallbackCompany || '';

  const location =
    (typeof raw.location === 'string' ? raw.location : '') ||
    (typeof raw.location === 'object' && raw.location?.linkedinText) ||
    (typeof raw.location === 'object' && raw.location?.default) ||
    raw.geo || raw.addressLocality || '';

  return { fullName, title, profileUrl, company, location };
}

// ─── Single Apify call with waitForFinish ───────────────────────────

/**
 * Start an Apify run and wait for it to finish in a single HTTP call.
 * Uses the ?waitForFinish parameter to avoid polling entirely.
 * Returns the dataset items directly.
 */
async function runActorAndGetResults(
  actorId: string,
  input: Record<string, any>,
): Promise<Record<string, any>[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('Missing APIFY_API_TOKEN environment variable');

  // Start run with waitForFinish — the API blocks until the run completes
  const res = await fetch(
    `${APIFY_BASE_URL}/acts/${actorId}/runs?token=${token}&waitForFinish=${WAIT_FOR_FINISH_SECS}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify run failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const status = json.data?.status;
  const datasetId = json.data?.defaultDatasetId;

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run status: ${status}`);
  }

  if (!datasetId) {
    throw new Error('No dataset ID returned');
  }

  // Fetch the dataset items
  const itemsRes = await fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${token}&format=json`,
  );

  if (!itemsRes.ok) {
    throw new Error(`Failed to fetch dataset (${itemsRes.status})`);
  }

  return itemsRes.json();
}

// ─── Main Export: searchWithFallback ────────────────────────────────

/**
 * Search for contacts at a company.
 *
 * Makes ONE Apify call with ALL relevant title keywords at once.
 * This is fast enough (7-22s) to fit within Vercel Hobby's 60s limit
 * even when processing multiple companies sequentially.
 *
 * @param companyName - Target company
 * @param buyerType - 'PE' or 'Strategic'
 * @returns LinkedIn results — all confirmed employees of this company
 */
export async function searchWithFallback(
  companyName: string,
  buyerType: 'PE' | 'Strategic',
): Promise<LinkedInPerson[]> {
  const allTitles = buyerType === 'PE' ? ALL_PE_TITLES : ALL_STRATEGIC_TITLES;
  const actorId = process.env.APIFY_ACTOR_ID || EMPLOYEES_ACTOR_ID;

  const input = {
    companies: [companyName],
    jobTitles: allTitles,
    maxItems: 10,
    profileScraperMode: 'Short ($4 per 1k)',
  };

  console.log(`[Apify] Searching ${companyName} employees: titles=[${allTitles.join(', ')}]`);

  try {
    const rawItems = await runActorAndGetResults(actorId, input);

    console.log(`[Apify] Got ${rawItems.length} employee results for ${companyName}`);

    // Debug: log first result's structure
    if (rawItems.length > 0) {
      const keys = Object.keys(rawItems[0]);
      console.log(`[Apify] Raw keys: ${keys.join(', ')}`);
    }

    const normalized = rawItems
      .map(raw => normalizeResult(raw, companyName))
      .filter(p => p.fullName && p.fullName.trim().length > 0);

    if (normalized.length > 0) {
      console.log(`[Apify] Normalized ${normalized.length} results. First: ${normalized[0].fullName} — ${normalized[0].title}`);
    } else if (rawItems.length > 0) {
      console.log(`[Apify] WARNING: ${rawItems.length} results lost after normalization!`);
      console.log(`[Apify] First raw: ${JSON.stringify(rawItems[0]).slice(0, 500)}`);
    }

    return normalized;
  } catch (err: any) {
    console.error(`[Apify] Search failed for "${companyName}":`, err?.message);
    return [];
  }
}

// Keep this export for the research-worker's single-company retry
export async function searchLinkedInPeople(
  companyName: string,
  roleKeywords: string,
  maxResults: number = 10,
): Promise<LinkedInPerson[]> {
  // For retry, also use the single-call approach
  const actorId = process.env.APIFY_ACTOR_ID || EMPLOYEES_ACTOR_ID;
  const titles = roleKeywords.split(' OR ').map(t => t.trim());

  const input = {
    companies: [companyName],
    jobTitles: titles,
    maxItems: maxResults,
    profileScraperMode: 'Short ($4 per 1k)',
  };

  try {
    const rawItems = await runActorAndGetResults(actorId, input);
    return rawItems
      .map(raw => normalizeResult(raw, companyName))
      .filter(p => p.fullName && p.fullName.trim().length > 0)
      .slice(0, maxResults);
  } catch (err: any) {
    console.error(`[Apify] Retry search failed for "${companyName}":`, err?.message);
    return [];
  }
}
