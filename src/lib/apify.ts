/**
 * Apify LinkedIn People Search Client
 *
 * Uses the Apify API to search LinkedIn for people at a given company.
 * Compatible with most LinkedIn People Search actors on the Apify marketplace.
 *
 * Default actor: curious_coder/linkedin-people-search-scraper
 * Override via APIFY_ACTOR_ID env var.
 */

const APIFY_BASE_URL = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_ID = 'curious_coder~linkedin-people-search-scraper';
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
 * Normalize varying field names from different Apify actors into our standard shape.
 */
function normalizeResult(raw: Record<string, any>): LinkedInPerson {
  return {
    fullName: raw.fullName || raw.name || raw.full_name ||
      (raw.firstName && raw.lastName ? `${raw.firstName} ${raw.lastName}`.trim() : ''),
    title: raw.title || raw.headline || raw.jobTitle || raw.job_title || '',
    profileUrl: raw.profileUrl || raw.linkedinUrl || raw.linkedin_url || raw.url || raw.profileLink || '',
    company: raw.company || raw.companyName || raw.company_name || raw.currentCompany || '',
    location: raw.location || raw.geo || '',
  };
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
  // Build the LinkedIn search URL
  // Most actors accept either a searchUrl or keyword-based input
  const searchQuery = `${roleKeywords} ${companyName}`;

  const input = {
    // Common input formats across different actors:
    searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`,
    queries: [searchQuery],
    keyword: searchQuery,
    maxResults,
    resultsLimit: maxResults,
  };

  const { runId } = await startRun(input);
  const datasetId = await waitForRun(runId);
  const rawItems = await getDatasetItems(datasetId);

  return rawItems
    .map(normalizeResult)
    .filter(p => p.fullName && p.fullName.trim().length > 0)
    .slice(0, maxResults);
}

/**
 * Run multiple search rounds for a company, progressively broadening keywords.
 * Stops as soon as any round returns results that score above the threshold.
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
        '"Vice President" OR "Principal" OR "Senior Associate"',
        '"Managing Director" OR "Partner"',
        '"Business Development"',
      ]
    : [
        '"M&A" OR "Corporate Development" OR "Corp Dev"',
        '"Strategy" OR "Business Development"',
        '"CFO" OR "CEO"',
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
