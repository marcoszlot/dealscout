/**
 * Algorithmic Contact Scorer
 *
 * Scores LinkedIn search results against the PE/Strategic hierarchy
 * defined in RESEARCH_GUIDE.md. No AI tokens used — pure keyword matching.
 */

import { LinkedInPerson } from './apify';
import { ContactResult } from './types';

// ─── Hierarchy Definitions ───────────────────────────────────────────

interface HierarchyLevel {
  keywords: string[];         // title must contain at least one of these
  negativeKeywords?: string[]; // title must NOT contain these (to avoid false positives)
  score: number;
  level: string;              // maps to ContactResult.level
}

const PE_HIERARCHY: HierarchyLevel[] = [
  {
    keywords: ['vice president', 'vp'],
    negativeKeywords: ['business development', 'biz dev', 'marketing', 'sales', 'operations', 'hr', 'human resources', 'talent'],
    score: 100,
    level: 'VP',
  },
  {
    keywords: ['principal'],
    negativeKeywords: ['principal engineer', 'principal designer', 'principal consultant'],
    score: 95,
    level: 'Principal',
  },
  {
    keywords: ['senior associate'],
    negativeKeywords: ['sales', 'marketing', 'hr'],
    score: 85,
    level: 'Associate',
  },
  {
    keywords: ['managing director', ' md '],
    negativeKeywords: ['marketing', 'sales', 'hr'],
    score: 75,
    level: 'MD',
  },
  {
    keywords: ['partner', 'managing partner', 'general partner'],
    negativeKeywords: ['hr partner', 'talent partner', 'people partner'],
    score: 60,
    level: 'Partner',
  },
  {
    keywords: ['vp business development', 'vice president business development', 'md business development', 'director business development'],
    score: 50,
    level: 'VP',
  },
];

const STRATEGIC_HIERARCHY: HierarchyLevel[] = [
  {
    keywords: [
      'head of m&a', 'vp m&a', 'vice president m&a',
      'm&a director', 'director of m&a', 'director m&a',
      'head of mergers', 'mergers and acquisitions',
      'm&a manager', 'm&a specialist', 'm&a analyst',
      'm&a associate', 'm&a lead', 'm&a counsel',
      'strategy and m&a', 'strategy & m&a',
    ],
    score: 100,
    level: 'M&A',
  },
  {
    keywords: ['corporate development', 'corp dev', 'vp corporate development', 'vice president corporate development', 'director corporate development'],
    score: 95,
    level: 'CorpDev',
  },
  {
    keywords: ['svp strategy', 'chief strategy officer', 'cso', 'head of strategy', 'vp strategy', 'strategy director', 'director of strategy', 'strategy manager'],
    score: 80,
    level: 'CorpDev',
  },
  {
    keywords: ['vp business development', 'vice president business development', 'head of business development', 'director business development'],
    score: 70,
    level: 'CorpDev',
  },
  {
    keywords: ['cfo', 'chief financial officer'],
    score: 55,
    level: 'CFO',
  },
  {
    keywords: ['ceo', 'chief executive officer', 'president'],
    negativeKeywords: ['vice president', 'vp'],
    score: 40,
    level: 'CEO',
  },
  // Catch-all: anyone with 'm&a' in their title who didn't match above
  {
    keywords: ['m&a'],
    score: 90,
    level: 'M&A',
  },
];

// ─── Scoring Functions ───────────────────────────────────────────────

/**
 * Check if a title contains any of the keywords (case-insensitive).
 */
function titleContains(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase().trim()));
}

/**
 * Check if the company name from the LinkedIn result reasonably matches the target.
 */
function companyMatches(resultCompany: string, targetCompany: string): boolean {
  if (!resultCompany || !targetCompany) return false;

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const result = normalize(resultCompany);
  const target = normalize(targetCompany);

  // Exact match
  if (result === target) return true;

  // One contains the other (handles "Bain Capital" matching "Bain Capital Private Equity")
  if (result.includes(target) || target.includes(result)) return true;

  // First word match (handles "Goldman" matching "Goldman Sachs")
  const resultFirst = result.split(' ')[0];
  const targetFirst = target.split(' ')[0];
  if (resultFirst.length > 3 && resultFirst === targetFirst) return true;

  return false;
}

/**
 * Score a single LinkedIn result against one hierarchy.
 */
function scoreCandidate(
  person: LinkedInPerson,
  targetCompany: string,
  hierarchy: HierarchyLevel[],
): { score: number; level: string; matchedKeyword: string } | null {
  const title = person.title || '';

  for (const tier of hierarchy) {
    // Check positive keywords
    if (!titleContains(title, tier.keywords)) continue;

    // Check negative keywords
    if (tier.negativeKeywords && titleContains(title, tier.negativeKeywords)) continue;

    // Base score from hierarchy
    let score = tier.score;

    // Company match bonus/penalty
    // Note: when using the company-employees actor, all results are from
    // the target company already, but the company field might be empty
    // in the response. So we're lenient on "unknown company" when results
    // come from the employees actor (they're guaranteed correct).
    if (companyMatches(person.company, targetCompany)) {
      score += 10; // bonus for confirmed company match
    } else if (person.company) {
      // Different company name — could be a subsidiary or different spelling
      // Moderate penalty (not severe, since employees actor guarantees the company)
      score *= 0.6;
    }
    // If company is empty/unknown, no penalty — the employees actor
    // already filtered to the right company

    // Extra signal: company name in their headline (e.g. "VP at Celcoin")
    const titleLower = title.toLowerCase();
    const companyLower = targetCompany.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (companyLower.length > 2 && titleLower.includes(companyLower)) {
      score += 10;
    }

    // Profile completeness bonus
    if (person.profileUrl && person.profileUrl.includes('linkedin.com/in/')) {
      score += 2;
    }

    const matchedKeyword = tier.keywords.find(kw =>
      title.toLowerCase().includes(kw.toLowerCase().trim())
    ) || tier.keywords[0];

    return { score, level: tier.level, matchedKeyword };
  }

  return null;
}

// ─── Main Exports ────────────────────────────────────────────────────

export interface ScoredCandidate {
  person: LinkedInPerson;
  score: number;
  level: string;
  matchedKeyword: string;
}

/**
 * Score all LinkedIn results and return ALL contacts sorted by score.
 *
 * @param results - LinkedIn People Search results from Apify
 * @param targetCompany - The company we're looking for contacts at
 * @param buyerType - 'PE' or 'Strategic' — determines which hierarchy to use
 * @returns All scored contacts sorted by score descending, plus escalation info
 */
export function scoreAllContacts(
  results: LinkedInPerson[],
  targetCompany: string,
  buyerType: 'PE' | 'Strategic',
): { scored: ScoredCandidate[]; escalation: boolean; debugInfo: string } {
  const hierarchy = buyerType === 'PE' ? PE_HIERARCHY : STRATEGIC_HIERARCHY;
  const ESCALATION_THRESHOLD = 40;

  // Score all candidates
  const scored: ScoredCandidate[] = [];

  for (const person of results) {
    const result = scoreCandidate(person, targetCompany, hierarchy);
    if (result) {
      scored.push({ person, ...result });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const escalation = scored.length === 0 || scored[0].score < ESCALATION_THRESHOLD;
  const debugInfo = `${results.length} LinkedIn results, ${scored.length} scored. Top titles: ${results.slice(0, 3).map(r => r.title).join('; ')}`;

  return { scored, escalation, debugInfo };
}

/**
 * Score all LinkedIn results and return the best contact.
 * (Kept for backward compatibility)
 */
export function selectBestContact(
  results: LinkedInPerson[],
  targetCompany: string,
  buyerType: 'PE' | 'Strategic',
): ContactResult {
  const { scored, escalation, debugInfo } = scoreAllContacts(results, targetCompany, buyerType);
  const ESCALATION_THRESHOLD = 40;

  if (escalation) {
    return {
      name: '',
      title: '',
      linkedin: '',
      level: '',
      notes: `Algorithmic search: ${debugInfo}, none above threshold (${ESCALATION_THRESHOLD}).`,
      status: 'escalation',
    };
  }

  const best = scored[0];

  return {
    name: best.person.fullName,
    title: best.person.title,
    linkedin: best.person.profileUrl,
    level: best.level,
    notes: `Score: ${Math.round(best.score)} | Matched: "${best.matchedKeyword}" | Company: ${best.person.company || 'unknown'} | ${scored.length} candidates evaluated`,
    status: 'found',
  };
}
