-- DealScout Database Schema

CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  total_companies INT DEFAULT 0,
  completed INT DEFAULT 0,
  found INT DEFAULT 0,
  escalation INT DEFAULT 0,
  status TEXT DEFAULT 'draft' -- draft, running, paused, completed
);

CREATE TABLE companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  buyer_type TEXT NOT NULL, -- 'PE' or 'Strategic'
  tier TEXT,
  hq TEXT,
  website TEXT,
  segment TEXT,
  ma_track_record TEXT,
  portfolio_companies TEXT,
  deal_structure TEXT,
  ebitda_target TEXT,
  revenue_target TEXT,
  contact_name TEXT,
  contact_title TEXT,
  contact_linkedin TEXT,
  hierarchy_level TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending', -- pending, searching, found, escalation, error
  search_attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_companies_project ON companies(project_id);
CREATE INDEX idx_companies_status ON companies(status);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE companies;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;

-- RLS (simplified for MVP)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_access" ON projects FOR ALL USING (true);
CREATE POLICY "public_access" ON companies FOR ALL USING (true);
