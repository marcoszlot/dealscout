export interface Project {
  id: string;
  name: string;
  created_at: string;
  total_companies: number;
  completed: number;
  found: number;
  escalation: number;
  status: 'draft' | 'running' | 'paused' | 'completed';
}

export interface Company {
  id: string;
  project_id: string;
  company_name: string;
  buyer_type: 'PE' | 'Strategic';
  tier: string | null;
  hq: string | null;
  website: string | null;
  segment: string | null;
  ma_track_record: string | null;
  portfolio_companies: string | null;
  deal_structure: string | null;
  ebitda_target: string | null;
  revenue_target: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_linkedin: string | null;
  hierarchy_level: string | null;
  notes: string | null;
  status: 'pending' | 'searching' | 'found' | 'escalation' | 'error';
  search_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface ParsedCompany {
  company_name: string;
  buyer_type: 'PE' | 'Strategic';
  tier?: string;
  hq?: string;
  website?: string;
  segment?: string;
  ma_track_record?: string;
  portfolio_companies?: string;
  deal_structure?: string;
  ebitda_target?: string;
  revenue_target?: string;
}

export interface ContactResult {
  name: string;
  title: string;
  linkedin: string;
  level: string;
  notes: string;
  status: 'found' | 'escalation';
}
