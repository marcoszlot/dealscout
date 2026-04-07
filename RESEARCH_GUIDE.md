# DealScout Research Guide

This document defines the contact search hierarchy and scoring rules used by the algorithmic contact selector. It is the single source of truth for how contacts are ranked and selected.

## Overview

DealScout finds the best M&A deal contact at each company by:
1. Searching LinkedIn via Apify People Search (by company name + role keywords)
2. Scoring each result against a title-based hierarchy
3. Selecting the highest-scoring match

---

## PE / Growth Fund Hierarchy

Search in this exact priority order — **stop at the first level where a match is found**:

| Priority | Title Keywords                          | Score | Notes                    |
|----------|-----------------------------------------|-------|--------------------------|
| 1        | Vice President, VP (Investment)         | 100   | Deal execution — SWEET SPOT |
| 2        | Principal                               | 95    | Investment leadership — SWEET SPOT |
| 3        | Senior Associate                        | 85    | Deal screening           |
| 4        | Managing Director, MD                   | 75    | Senior deal leadership   |
| 5        | Partner, Managing Partner               | 60    | Firm leadership (last resort) |
| 6        | VP Business Development, MD Business Dev| 50    | Only if no investment team |

### PE Search Keywords
Use these queries against the Apify LinkedIn People Search:
- `"Vice President" OR "Principal" OR "Senior Associate"` + company name
- `"Managing Director" OR "Partner"` + company name (fallback)
- `"Business Development"` + company name (last resort)

---

## Strategic / Corporate Hierarchy

Search in this exact priority order — **stop at the first level where a match is found**:

| Priority | Title Keywords                                   | Score | Notes                          |
|----------|--------------------------------------------------|-------|--------------------------------|
| 1        | Head of M&A, VP M&A, M&A Director               | 100   | IDEAL                          |
| 2        | VP Corporate Development, Corp Dev Director      | 95    | IDEAL                          |
| 3        | SVP Strategy, Chief Strategy Officer, CSO        | 80    | Strategy leadership            |
| 4        | VP Business Development (with M&A context)       | 70    | Only if role includes M&A      |
| 5        | CFO, Chief Financial Officer                     | 55    | Only if no Corp Dev/M&A exists |
| 6        | CEO, President                                   | 40    | LAST RESORT — small companies  |

### Strategic Search Keywords
- `"M&A" OR "Corporate Development" OR "Corp Dev"` + company name
- `"Strategy" OR "Business Development"` + company name (fallback)
- `"CFO" OR "CEO"` + company name (last resort)

---

## Scoring Rules

### Title Match Scoring
Each LinkedIn result is scored by matching the person's title against the hierarchy keywords:

1. **Exact keyword match** in title → base score from table above
2. **Partial match** (e.g., "VP" in "SVP of Operations") → base score × 0.7
3. **Company name match** — result must be at the target company (±0.9 penalty if company name doesn't match)
4. **LinkedIn profile completeness** — profiles with photos and full details get a +5 bonus

### Tiebreakers
When multiple candidates score the same:
1. Prefer the one whose current company exactly matches the target
2. Prefer the one with a more specific M&A/deal-related title
3. Prefer the one listed first in search results (LinkedIn relevance)

### Escalation Criteria
Mark as **escalation** (no contact found) when:
- Zero results from Apify after all keyword rounds
- No result scores above **40 points**
- All results are at a different company (name mismatch)

---

## Batch Processing Rules

- Each **subagent** (batch worker) handles up to **10 companies**
- Total subagents deployed = `Math.ceil(totalCompanies / 10)`
- All subagents run in **parallel** for maximum speed
- Each company within a batch is processed **sequentially** (to respect Apify rate limits)
- Delay between Apify calls: **1 second**

---

## Apify Configuration

- **Actor**: `apify/linkedin-people-search` (or equivalent)
- **Max results per search**: 10 profiles
- **Search rounds per company**: up to 3 (progressively broader keywords)
- **Timeout per search**: 30 seconds
