/**
 * Apify LinkedIn Company Employees Client
 *
 * Uses harvestapi/linkedin-company-employees to search the People tab
 * of a company's LinkedIn page. This guarantees results are actual employees,
 * not random people from all over LinkedIn.
 *
 * No cookies or LinkedIn account required.
 * Pricing: covered by Apify free tier ($5/mo credits)
 * Free tier: up to 10 employees per company (perfect for our use case)
 */

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const EMPLOYEES_ACTOR_ID = 'harvestapi~linkedin-company-employees';
const SEARCH_ACTOR_ID = 'harvestapi~linkedin-profile-search';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40; // 3s × 40 = 2 min max wait

export interface LinkedInPerson {
  fullName: string;
  title: string;        // headline / job title
  profileUrl: string;   // linkedin.com/in/...
  company: string;
  location: string;
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface ApifyRunStatus {
  data: {
    id: string;
    status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTING' | 'ABORTED' | 'TIMED-OUT';
    defaultDatasetId: string;
  };
}

/**
 * Extract a company name from nested position arrays if present.
 */
function extractCompanyFromPositions(raw: Record<string, any>): string {
  // Note: harvestapi employees actor uses "currentPositions" (plural with 's')
  for (const key of ['currentPositions', 'currentPosition', 'positions', 'experience']) {
    if (Array.isArray(raw[key]) && raw[key].length > 0) {
      return raw[key][0].companyName || raw[key][0].company || '';
    }
  }
  return '';
}

/**
 * Extract title from nested position arrays if top-level headline is empty.
 */
function extractTitleFromPositions(raw: Record<string, any>): string {
  // Note: harvestapi employees actor uses "currentPositions" (plural with 's')
  for (const key of ['currentPositions', 'currentPosition', 'positions', 'experience']) {
    if (Array.isArray(raw[key]) && raw[key].length > 0) {
      return raw[key][0].title || raw[key][0].position || raw[key][0].description || '';
    }
  }
  return '';
}

/**
 * Normalize varying field names from Apify actors into our standard shape.
 */
function normalizeResult(raw: Record<string, any>, fallbackCompany?: string): LinkedInPerson {
  // Name
  const fullName =
    raw.fullName || raw.full_name || raw.name ||
    (raw.firstName && raw.lastName
      ? `${raw.firstName} ${raw.lastName}`.trim()
      : raw.firstName || raw.lastName || '');

  // Title / headline — NEVER use raw.summary (that's the bio "About" section)
  const rawTitle =
    raw.headline || raw.title || raw.jobTitle || raw.job_title ||
    raw.currentJobTitle || raw.position || raw.subTitle || raw.tagline ||
    extractTitleFromPositions(raw) || '';
  // Safety: if longer than 200 chars, it's a bio not a headline
  const title = rawTitle.length > 200 ? '' : rawTitle;

  // LinkedIn URL
  const profileUrl =
    raw.linkedinUrl || raw.linkedin_url || raw.linkedInUrl ||
    raw.profileUrl || raw.profile_url || raw.url || raw.profileLink ||
    (raw.publicIdentifier
      ? `https://www.linkedin.com/in/${raw.publicIdentifier}`
      : '') || '';

  // Company — for the employees actor, we know the company already
  const company =
    raw.company || raw.companyName || raw.company_name ||
    raw.currentCompany || raw.current_company ||
    extractCompanyFromPositions(raw) ||
    fallbackCompany || '';

  // Location — harvestapi returns { linkedinText: "São Paulo, Brazil" }
  const location =
    (typeof raw.location === 'string' ? raw.location : '') ||
    (typeof raw.location === 'object' && raw.location?.linkedinText) ||
    (typeof raw.location === 'object' && raw.location?.default) ||
    raw.geo || raw.addressLocality || '';

  return { fullName, title, profileUrl, company, location };
}

// ─── Low-level Apify API helpers ─────────────────────────────────────

async function startRun(actorId: string, input: Record<string, any>): Promise<{ runId: string; datasetId: string }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('Missing APIFY_API_TOKEN environment variable');

  const res = await fetch(`${APIFY_BASE_URL}/acts/${actorId}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify start run failed (${res.status}): ${text}`);
  }

  const json: ApifyRunResponse = await res.json();
  return {
    runId: json.data.id,
    datasetId: json.data.defaultDatasetId,
  };
}

async function waitForRun(runId: string): Promise<string> {
  const token = process.env.APIFY_API_TOKEN;

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${APIFY_BASE_URL}/actor-runs/${runId}?token=${token}`);
    if (!res.ok) continue;

    const json: ApifyRunStatus = await res.json();
    const status = json.data.status;

    if (status === 'SUCCEEDED') return json.data.defaultDatasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new Error(`Apify run ${status}`);
    }
  }

  throw new Error('Apify run timed out after polling');
}

async function getDatasetItems(datasetId: string): Promise<Record<string, any>[]> {
  const token = process.env.APIFY_API_TOKEN;

  const res = await fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${token}&format=json`
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch dataset (${res.status})`);
  }

  return res.json();
}

// ─── Company Employees Search (PRIMARY method) ──────────────────────

/**
 * Search a company's LinkedIn People tab for employees with specific titles.
 *
 * This goes directly to the company's employee list — guaranteeing all
 * results are actual employees of that company.
 *
 * @param companyName - Company name (actor will find the LinkedIn page)
 * @param titleKeywords - Job title filter keywords (e.g., "Corporate Development")
 * @param maxResults - Max employees to return (free tier: 10)
 */
async function searchCompanyEmployees(
  companyName: string,
  titleKeywords: string,
  maxResults: number = 10,
): Promise<LinkedInPerson[]> {
  const actorId = process.env.APIFY_ACTOR_ID || EMPLOYEES_ACTOR_ID;

  // Input for harvestapi/linkedin-company-employees:
  // - companies: list of company names (it will find the LinkedIn page)
  // - jobTitles: filter by these job titles on the People tab
  // - maxItems: max employees to return
  // - profileScraperMode: must use the exact enum values the actor expects
  const input = {
    companies: [companyName],
    jobTitles: titleKeywords.split(' OR ').map(t => t.trim()),
    maxItems: maxResults,
    profileScraperMode: 'Short ($4 per 1k)',
  };

  console.log(`[Apify] Employees search: "${companyName}" titles=[${input.jobTitles.join(', ')}]`);

  const { runId } = await startRun(actorId, input);
  const datasetId = await waitForRun(runId);
  const rawItems = await getDatasetItems(datasetId);

  console.log(`[Apify] Got ${rawItems.length} employee results`);

  // DEBUG: Log raw field names so we can verify the mapping
  if (rawItems.length > 0) {
    const sample = rawItems[0];
    const keys = Object.keys(sample);
    console.log(`[Apify] Raw keys: ${keys.join(', ')}`);
    for (const key of keys) {
      const val = sample[key];
      const type = Array.isArray(val) ? 'array' : typeof val;
      const preview = typeof val === 'string' ? val.slice(0, 100) : JSON.stringify(val)?.slice(0, 100);
      console.log(`[Apify]   ${key} (${type}): ${preview}`);
    }
  }

  const normalized = rawItems
    .map(raw => normalizeResult(raw, companyName))
    .filter(p => p.fullName && p.fullName.trim().length > 0);

  if (normalized.length > 0) {
    console.log(`[Apify] First normalized: ${JSON.stringify(normalized[0])}`);
  } else if (rawItems.length > 0) {
    console.log(`[Apify] WARNING: ${rawItems.length} results lost after normalization!`);
    console.log(`[Apify] First raw: ${JSON.stringify(rawItems[0]).slice(0, 800)}`);
  }

  return normalized.slice(0, maxResults);
}

// ─── Fallback: General Profile Search ───────────────────────────────

/**
 * Fallback: general LinkedIn search if company employees actor returns nothing.
 * Less precise but broader reach.
 */
async function searchProfilesFallback(
  companyName: string,
  roleKeywords: string,
  maxResults: number = 10,
): Promise<LinkedInPerson[]> {
  const searchQuery = `${companyName} ${roleKeywords}`;

  const input = {
    searchQuery,
    maxItems: maxResults,
    profileScraperMode: 'Short',
  };

  console.log(`[Apify] Fallback profile search: "${searchQuery}"`);

  const { runId } = await startRun(SEARCH_ACTOR_ID, input);
  const datasetId = await waitForRun(runId);
  const rawItems = await getDatasetItems(datasetId);

  console.log(`[Apify] Fallback got ${rawItems.length} results`);

  return rawItems
    .map(raw => normalizeResult(raw, companyName))
    .filter(p => p.fullName && p.fullName.trim().length > 0)
    .slice(0, maxResults);
}

// ─── Main Export: searchWithFallback ────────────────────────────────

/**
 * Search for contacts at a company using a two-phase approach:
 *
 * Phase 1: Company Employees actor (People tab) — precise, guaranteed correct company
 * Phase 2: General profile search — broader, used only if Phase 1 returns nothing
 *
 * Within each phase, we try progressively broader keyword rounds.
 *
 * @param companyName - Target company
 * @param buyerType - 'PE' or 'Strategic'
 * @returns LinkedIn results from the first successful round
 */
export async function searchWithFallback(
  companyName: string,
  buyerType: 'PE' | 'Strategic',
): Promise<LinkedInPerson[]> {
  const searchRounds = buyerType === 'PE'
    ? [
        'Vice President OR Principal OR Senior Associate',
        'Managing Director OR Partner',
        'Business Development',
      ]
    : [
        'M&A OR Corporate Development OR Corp Dev',
        'Strategy OR Business Development',
        'CFO OR CEO',
      ];

  // ─── Phase 1: Company Employees (People tab) ───
  console.log(`[Apify] Phase 1: Searching ${companyName} employees...`);

  for (const keywords of searchRounds) {
    try {
      const results = await searchCompanyEmployees(companyName, keywords, 10);
      if (results.length > 0) {
        console.log(`[Apify] Phase 1 success: ${results.length} employees found`);
        return results;
      }
    } catch (err: any) {
      console.error(`[Apify] Employees search failed for "${companyName}" with "${keywords}":`, err?.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // ─── Phase 2: Fallback to general profile search ───
  console.log(`[Apify] Phase 2: Falling back to profile search for ${companyName}...`);

  for (const keywords of searchRounds) {
    try {
      const results = await searchProfilesFallback(companyName, keywords, 10);
      if (results.length > 0) {
        console.log(`[Apify] Phase 2 success: ${results.length} profiles found`);
        return results;
      }
    } catch (err: any) {
      console.error(`[Apify] Fallback search failed for "${companyName}" with "${keywords}":`, err?.message);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return []; // Nothing found anywhere
}

// Keep this export for the research-worker's single-company retry
export async function searchLinkedInPeople(
  companyName: string,
  roleKeywords: string,
  maxResults: number = 10,
): Promise<LinkedInPerson[]> {
  return searchCompanyEmployees(companyName, roleKeywords, maxResults);
}
