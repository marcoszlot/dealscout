import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase';

export const maxDuration = 120;

const SYSTEM_PROMPT = `You are an IB analyst finding M&A deal contacts. You research ONE company at a time. Use web_search to find the best deal decision-maker at the given company.

CRITICAL RULES:
1. Search ONLY LinkedIn (site:linkedin.com/in) and company websites
2. Return ONLY valid JSON — no markdown, no explanation, no backticks, no preamble
3. Follow the hierarchy STRICTLY — stop at the FIRST level where you find someone
4. Never skip to a senior person if a more junior deal-facing person exists
5. Try 2-3 different search queries before marking as escalation

PE/GROWTH FUND HIERARCHY (search in this exact order — STOP at first match):
1. Vice President — deal execution level ← SWEET SPOT
2. Principal — investment leadership ← SWEET SPOT
3. Senior Associate — deal screening
4. Managing Director — senior deal leadership
5. Partner / Managing Partner — firm leadership (LAST RESORT)
6. VP/MD Business Development — only if no investment team match

STRATEGIC/CORPORATE HIERARCHY (search in this exact order — STOP at first match):
1. Head of M&A / VP M&A / M&A Director ← IDEAL
2. VP Corporate Development / Corp Dev Director ← IDEAL
3. SVP Strategy / Chief Strategy Officer
4. VP Business Development (only if role includes M&A)
5. CFO (only if no Corp Dev/M&A exists)
6. CEO / President (LAST RESORT — only for companies <50 employees)

SEARCH STRATEGY:
- For PE: First search for the firm's website /team or /people page. Then try LinkedIn.
- For Strategic: First search "site:linkedin.com/in [company] corporate development OR M&A". Then try company website /leadership or /about page.
- If first search fails, try 2 more different queries before giving up.

RESPONSE FORMAT — Return ONLY this JSON, nothing else:
{"name":"Full Name","title":"Exact Job Title","linkedin":"linkedin.com/in/slug","level":"VP|Principal|Associate|MD|Partner|CorpDev|M&A|CFO|CEO","notes":"Why selected","status":"found"}

If no contact found after exhausting searches:
{"name":"","title":"","linkedin":"","level":"","notes":"Searched: [what was tried]","status":"escalation"}`;

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

    // Build user message
    let userMsg = `Find the best deal contact at this company:\n\nCompany: ${company.company_name}\nType: ${company.buyer_type}\nWebsite: ${company.website || 'unknown'}`;

    if (company.buyer_type === 'PE') {
      userMsg += `\nPortfolio Companies: ${company.portfolio_companies || 'N/A'}\nEBITDA Target: ${company.ebitda_target || 'N/A'}`;
    } else {
      userMsg += `\nHQ: ${company.hq || 'N/A'}\nSegment: ${company.segment || 'N/A'}\nM&A Track Record: ${company.ma_track_record || 'N/A'}`;
    }
    userMsg += '\n\nReturn JSON only.';

    // Call Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let retries = 0;
    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    while (retries <= MAX_RETRIES) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
          messages: [{ role: 'user', content: userMsg }],
        });

        // Extract text from response
        const allText = response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');

        const cleanJson = allText.replace(/```json|```/g, '').trim();
        const match = cleanJson.match(/\{[\s\S]*\}/);

        if (!match) {
          if (retries < MAX_RETRIES) {
            retries++;
            continue;
          }
          throw new Error('No JSON found in response');
        }

        const result = JSON.parse(match[0]);

        // Save result
        await supabase
          .from('companies')
          .update({
            contact_name: result.name || null,
            contact_title: result.title || null,
            contact_linkedin: result.linkedin || null,
            hierarchy_level: result.level || null,
            notes: result.notes || null,
            status: result.status === 'found' ? 'found' : 'escalation',
            search_attempts: company.search_attempts + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', company_id);

        return NextResponse.json({ ok: true, status: result.status });
      } catch (err: any) {
        lastError = err;

        // Handle rate limits
        if (err?.status === 429) {
          await new Promise(r => setTimeout(r, 30000));
          retries++;
          continue;
        }
        if (err?.status === 529) {
          await new Promise(r => setTimeout(r, 60000));
          retries++;
          continue;
        }

        if (retries < MAX_RETRIES) {
          retries++;
          continue;
        }
        break;
      }
    }

    // All retries failed
    await supabase
      .from('companies')
      .update({
        status: 'error',
        notes: `Error: ${lastError?.message || 'Unknown error'}`,
        search_attempts: company.search_attempts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', company_id);

    return NextResponse.json({ ok: false, error: lastError?.message }, { status: 500 });
  } catch (error: any) {
    console.error('Research error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
