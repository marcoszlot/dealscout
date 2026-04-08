/**
 * Apify LinkedIn People Search Client
 *
 * Uses the Apify API to search LinkedIn for people at a given company.
 * Default actor: harvestapi/linkedin-profile-search (no cookies, no rental fee)
 *
 * Pricing: ~$0.10 per search page (covered by Apify free tier $5/mo)
 * Override via APIFY_ACTOR_ID env var.
 */

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_ID = 'harvestapi~linkedin-profile-search';
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
 * Extract a company name from a currentPosition or positions array if present.
 */
function extractCompanyFromPositions(raw: Record<string, any>): string {
  // currentPosition (array) — harvestapi format
  if (Array.isArray(raw.currentPosition) && raw.currentPosition.length > 0) {
    return raw.currentPosition[0].companyName || raw.currentPosition[0].company || '';
  }
  // positions (array) — other formats
  if (Array.isArray(raw.positions) && raw.positions.length > 0) {
    return raw.positions[0].companyName || raw.positions[0].company || '';
  }
  // experience (array) — another common format
  if (Array.isArray(raw.experience) && raw.experience.length > 0) {
    return raw.experience[0].companyName || raw.experience[0].company || '';
  }
  return '';
}

/**
 * Extract title from currentPosition or positions array if top-level headline is empty.
 */
function extractTitleFromPositions(raw: Record<string, any>): string {
  if (Array.isArray(raw.currentPosition) && raw.currentPosition.length > 0) {
    return raw.currentPosition[0].title || raw.currentPosition[0].position || '';
  }
  if (Array.isArray(raw.positions) && raw.positions.length > 0) {
    return raw.positions[0].title || raw.positions[0].position || '';
  }
  if (Array.isArray(raw.experience) && raw.experience.length > 0) {
    return raw.experience[0].title || raw.experience[0].position || '';
  }
  return '';
}

/**
 * Normalize varying field names from different Apify actors into our standard shape.
 * Covers: harvestapi, curious_coder, logical_scrapers, and generic formats.
 */
function normalizeResult(raw: Record<string, any>): LinkedInPerson {
  // Name: try many field combinations
  const fullName =
    raw.fullName || raw.full_name || raw.name ||
    (raw.firstName && raw.lastName
      ? `${raw.firstName} ${raw.lastName}`.trim()
      : raw.firstName || raw.lastName || '');

  // Title / headline: top-level fields first, then dig into positions
  const title =
    raw.headline || raw.title || raw.jobTitle || raw.job_title ||
    raw.currentJobTitle || raw.position || raw.summary ||
    extractTitleFromPositions(raw) || '';

  // LinkedIn URL: various field names
  const profileUrl =
    raw.linkedinUrl || raw.linkedin_url || raw.linkedInUrl ||
    raw.profileUrl || raw.profile_url || raw.url || raw.profileLink ||
    (raw.publicIdentifier
      ? `https://www.linkedin.com/in/${raw.publicIdentifier}`
      : '') || '';

  // Company: top-level first, then dig into positions
  const company =
    raw.company || raw.companyName || raw.company_name ||
    raw.currentCompany || raw.current_company ||
    extractCompanyFromPositions(raw) || '';

  // Location
  const location =
    raw.location || raw.geo || raw.addressLocality ||
    (typeof raw.location === 'object' && raw.location?.default) || '';

  return { fullName, title, profileUrl, company, location };
}

/**
 * Start an Apify actor run and return the run ID + dataset ID.
 */
async function startRun(input: Record<string, any>): Promise<{ runId: string; datasetId: string }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('Missing APIFY_API_TOKEN environment variable');

  const actorId = process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR_ID;

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

/**
 * Poll until the run completes (or fails/times out).
 */
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
    // Still RUNNING or READY — keep polling
  }

  throw new Error('Apify run timed out after polling');
}

/**
 * Fetch dataset items from a completed run.
 */
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

/**
 * Search LinkedIn for people at a specific company with given role keywords.
 *
 * Uses the harvestapi/linkedin-profile-search actor input format:
 * - searchQuery: general fuzzy search (combines role keywords + company name)
 * - maxItems: max number of profiles to return
 * - profileScraperMode: "Short" for basic data (cheapest — $0.10/page only)
 *
 * @param companyName - The company to search for
 * @param roleKeywords - Role/title keywords (e.g., "Vice President OR Principal")
 * @param maxResults - Max profiles to return (default 10)
 * @returns Array of normalized LinkedIn person results
 */
export async function searchLinkedInPeople(
  companyName: string,
  roleKeywords: string,
  maxResults: number = 10,
): Promise<LinkedInPerson[]> {
  const searchQuery = `${roleKeywords} ${companyName}`;

  // Input format for harvestapi/linkedin-profile-search
  const input = {
    searchQuery,
    maxItems: maxResults,
    profileScraperMode: 'Short',  // cheapest mode — basic profile data only
  };

  console.log(`[Apify] Searching: "${searchQuery}" (max ${maxResults})`);

  const { runId } = await startRun(input);
  const datasetId = await waitForRun(runId);
  const rawItems = await getDatasetItems(datasetId);

  console.log(`[Apify] Got ${rawItems.length} raw results`);

  // ─── DEBUG: Log the first raw result so we can see exact field names ───
  if (rawItems.length > 0) {
    const sample = rawItems[0];
    const keys = Object.keys(sample);
    console.log(`[Apify] Raw result keys: ${keys.join(', ')}`);
    console.log(`[Apify] Sample raw result: ${JSON.stringify(sample).slice(0, 500)}`);
  }

  const normalized = rawItems
    .map(normalizeResult)
    .filter(p => p.fullName && p.fullName.trim().length > 0);

  // ─── DEBUG: Log first normalized result ───
  if (normalized.length > 0) {
    console.log(`[Apify] First normalized: ${JSON.stringify(normalized[0])}`);
  } else {
    console.log(`[Apify] WARNING: All ${rawItems.length} results lost after normalization!`);
    if (rawItems.length > 0) {
      console.log(`[Apify] First raw for debugging: ${JSON.stringify(rawItems[0]).slice(0, 800)}`);
    }
  }

  return normalized.slice(0, maxResults);
}

/**
 * Run multiple search rounds for a company, progressively broadening keywords.
 * Stops as soon as any round returns results.
 *
 * @param companyName - Target company
 * @param buyerType - 'PE' or 'Strategic'
 * @returns All LinkedIn results from the first successful round
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

  for (const keywords of searchRounds) {
    try {
      const results = await searchLinkedInPeople(companyName, keywords, 10);
      if (results.length > 0) return results;
    } catch (err) {
      console.error(`Apify search round failed for "${companyName}" with "${keywords}":`, err);
      // Continue to next round
    }

    // Respect rate limits between rounds
    await new Promise(r => setTimeout(r, 1000));
  }

  return []; // All rounds returned empty
}
