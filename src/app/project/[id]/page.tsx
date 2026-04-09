'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileSpreadsheet, Play, Pause, Download, Search, ExternalLink,
  Linkedin, X, RefreshCw, Edit3, Check, Loader2, ChevronLeft,
  ChevronRight, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Project, Company } from '@/lib/types';

type StatusFilter = 'all' | 'found' | 'escalation' | 'pending' | 'searching' | 'error';
type TypeFilter = 'all' | 'PE' | 'Strategic';

export default function ProjectDashboard() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Side panel
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    contact_name: '',
    contact_title: '',
    contact_linkedin: '',
    notes: '',
  });

  // Flash animation tracking
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  // Fetch initial data
  useEffect(() => {
    async function fetchData() {
      const [{ data: proj }, { data: comps }] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('companies').select('*').eq('project_id', projectId).order('created_at'),
      ]);
      if (proj) setProject(proj as Project);
      if (comps) setCompanies(comps as Company[]);
      setLoading(false);
    }
    fetchData();
  }, [projectId]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`companies-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'companies',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const updated = payload.new as Company;
          setCompanies(prev => {
            const old = prev.find(c => c.id === updated.id);
            // Flash if just found
            if (old && old.status === 'searching' && updated.status === 'found') {
              toast.success(`Found contact at ${updated.company_name}`);
              setFlashIds(prev => new Set(prev).add(updated.id));
              setTimeout(() => {
                setFlashIds(prev => {
                  const next = new Set(prev);
                  next.delete(updated.id);
                  return next;
                });
              }, 600);
            }
            return prev.map(c => c.id === updated.id ? updated : c);
          });

          // Update selected company if open
          setSelectedCompany(prev =>
            prev?.id === updated.id ? updated : prev
          );
        }
      )
      .subscribe();

    const projectChannel = supabase
      .channel(`project-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'projects',
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          setProject(payload.new as Project);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(projectChannel);
    };
  }, [projectId]);

  // Computed stats
  const stats = useMemo(() => {
    const total = companies.length;
    const found = companies.filter(c => c.status === 'found').length;
    const escalation = companies.filter(c => c.status === 'escalation').length;
    const error = companies.filter(c => c.status === 'error').length;
    const completed = found + escalation + error;
    const pending = total - completed;
    const searching = companies.filter(c => c.status === 'searching').length;
    return { total, found, escalation, error, completed, pending, searching };
  }, [companies]);

  // Filtered companies
  const filtered = useMemo(() => {
    return companies.filter(c => {
      if (typeFilter !== 'all' && c.buyer_type !== typeFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          c.company_name.toLowerCase().includes(q) ||
          (c.contact_name || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [companies, typeFilter, statusFilter, searchQuery]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Estimated time
  const estimatedMinutes = useMemo(() => {
    if (stats.completed === 0 || stats.pending === 0) return null;
    // ~20 seconds per company average
    return Math.ceil((stats.pending * 20) / 60);
  }, [stats]);

  // Actions
  const handleStart = async () => {
    setActionLoading(true);
    try {
      await fetch('/api/research/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
    } catch (err) {
      console.error(err);
      toast.error('Failed to start research');
    }
    setActionLoading(false);
  };

  const handlePause = async () => {
    setActionLoading(true);
    try {
      await fetch('/api/research/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
    } catch (err) {
      console.error(err);
      toast.error('Failed to pause research');
    }
    setActionLoading(false);
  };

  const handleRetry = async (companyId: string) => {
    try {
      await fetch('/api/research/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      toast.success('Retrying research...');
    } catch (err) {
      toast.error('Failed to retry');
    }
  };

  const handleExport = () => {
    window.open(`/api/export/${projectId}`, '_blank');
  };

  const handleSaveEdit = async () => {
    if (!selectedCompany) return;
    try {
      await fetch('/api/companies/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: selectedCompany.id,
          ...editForm,
          status: editForm.contact_name ? 'found' : selectedCompany.status,
        }),
      });
      setEditing(false);
      toast.success('Contact updated');
    } catch (err) {
      toast.error('Failed to update');
    }
  };

  const handleMarkStatus = async (companyId: string, status: string) => {
    try {
      await fetch('/api/companies/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, status }),
      });
      toast.success(`Marked as ${status}`);
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const openEditPanel = (company: Company) => {
    setSelectedCompany(company);
    setEditForm({
      contact_name: company.contact_name || '',
      contact_title: company.contact_title || '',
      contact_linkedin: company.contact_linkedin || '',
      notes: company.notes || '',
    });
    setEditing(false);
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      found: 'bg-green-500/20 text-green-400 border-green-500/30',
      escalation: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      searching: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
      error: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${styles[status] || styles.pending}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white">
        Project not found
      </div>
    );
  }

  const progressPct = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1a1a1a] px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-blue-500" />
            <span className="text-xl font-bold text-white">DealScout</span>
          </Link>
          <span className="text-lg font-medium text-gray-300">{project.name}</span>
          <Link
            href="/"
            className="px-4 py-2 text-sm bg-[#1a1a1a] border border-[#333] rounded-lg text-gray-300
              hover:bg-[#222] transition-colors"
          >
            New Project
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-6 space-y-6">
        {/* Progress Bar */}
        <div className="bg-[#141414] border border-[#262626] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-gray-400">
                <span className="text-white font-semibold">{stats.completed}</span> of{' '}
                <span className="text-white font-semibold">{stats.total}</span> companies researched
                {' '}&middot;{' '}
                <span className="text-green-400">{stats.found} found</span>
                {' '}&middot;{' '}
                <span className="text-yellow-400">{stats.escalation} escalation</span>
                {' '}&middot;{' '}
                <span className="text-gray-400">{stats.pending} remaining</span>
              </p>
              {estimatedMinutes && project.status === 'running' && (
                <p className="text-xs text-gray-500">~{estimatedMinutes} min remaining</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {project.status === 'draft' && (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700
                    disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start Research
                </button>
              )}
              {project.status === 'running' && (
                <button
                  onClick={handlePause}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-yellow-600 hover:bg-yellow-700
                    disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                  Pause
                </button>
              )}
              {project.status === 'paused' && (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700
                    disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Resume
                </button>
              )}
              {project.status === 'completed' && (
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-2 text-green-400 font-medium">
                    <Check className="w-5 h-5" />
                    Research Complete
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-3 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'text-white' },
            { label: 'Found', value: stats.found, color: 'text-green-400' },
            { label: 'Escalation', value: stats.escalation, color: 'text-yellow-400' },
            { label: 'Pending', value: stats.pending, color: 'text-gray-400' },
          ].map(s => (
            <div key={s.label} className="bg-[#141414] border border-[#262626] rounded-xl p-5 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-sm text-gray-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Type tabs */}
          <div className="flex bg-[#141414] border border-[#262626] rounded-lg overflow-hidden">
            {(['all', 'PE', 'Strategic'] as TypeFilter[]).map(t => (
              <button
                key={t}
                onClick={() => { setTypeFilter(t); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  typeFilter === t
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-[#1a1a1a]'
                }`}
              >
                {t === 'all' ? 'All' : t === 'PE' ? 'PE Buyers' : 'Strategic Buyers'}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
            className="px-3 py-2 bg-[#141414] border border-[#262626] rounded-lg text-sm text-gray-300
              focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="found">Found</option>
            <option value="escalation">Escalation</option>
            <option value="pending">Pending</option>
            <option value="searching">Searching</option>
            <option value="error">Error</option>
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search companies..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="w-full pl-10 pr-4 py-2 bg-[#141414] border border-[#262626] rounded-lg text-sm
                text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-[#141414] border border-[#262626]
              rounded-lg text-sm text-gray-300 hover:bg-[#1a1a1a] transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        </div>

        {/* Table */}
        <div className="bg-[#141414] border border-[#262626] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#262626]">
                  {['Status', 'Company', 'Type', 'Tier', 'Contact', 'Title', 'LinkedIn', 'Notes'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1a]">
                {paginated.map(company => (
                  <tr
                    key={company.id}
                    onClick={() => openEditPanel(company)}
                    className={`
                      cursor-pointer hover:bg-[#1a1a1a] transition-colors
                      ${company.status === 'searching' ? 'animate-pulse bg-blue-500/5' : ''}
                      ${flashIds.has(company.id) ? 'animate-flash' : ''}
                    `}
                  >
                    <td className="px-4 py-3">{statusBadge(company.status)}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-white font-medium">{company.company_name}</p>
                        {company.website && (
                          <a
                            href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-gray-500 hover:text-blue-400 flex items-center gap-1"
                          >
                            {company.website.replace(/^https?:\/\//, '').replace(/^www\./, '')}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        company.buyer_type === 'PE'
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      }`}>
                        {company.buyer_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{company.tier || '—'}</td>
                    <td className="px-4 py-3 text-white">{company.contact_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-300 max-w-[200px] truncate">{company.contact_title || '—'}</td>
                    <td className="px-4 py-3">
                      {company.contact_linkedin ? (
                        <a
                          href={company.contact_linkedin.startsWith('http') ? company.contact_linkedin : `https://${company.contact_linkedin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          <Linkedin className="w-4 h-4" />
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate" title={company.notes || ''}>
                      {(() => {
                        try {
                          const parsed = JSON.parse(company.notes || '');
                          if (parsed?.summary) return parsed.summary;
                        } catch {}
                        return company.notes || '—';
                      })()}
                    </td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                      No companies match your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#262626]">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a1a1a]
                    disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm text-gray-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a1a1a]
                    disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Side Panel */}
      {selectedCompany && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedCompany(null)} />
          <div className="relative w-full max-w-md bg-[#141414] border-l border-[#262626] overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedCompany.company_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    {statusBadge(selectedCompany.status)}
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      selectedCompany.buyer_type === 'PE'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}>
                      {selectedCompany.buyer_type}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedCompany(null)}
                  className="p-1 text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Company Details */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Company Details</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {selectedCompany.tier && (
                    <div>
                      <p className="text-gray-500">Tier</p>
                      <p className="text-white">{selectedCompany.tier}</p>
                    </div>
                  )}
                  {selectedCompany.hq && (
                    <div>
                      <p className="text-gray-500">HQ</p>
                      <p className="text-white">{selectedCompany.hq}</p>
                    </div>
                  )}
                  {selectedCompany.website && (
                    <div className="col-span-2">
                      <p className="text-gray-500">Website</p>
                      <a
                        href={selectedCompany.website.startsWith('http') ? selectedCompany.website : `https://${selectedCompany.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        {selectedCompany.website} <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  {selectedCompany.segment && (
                    <div className="col-span-2">
                      <p className="text-gray-500">Segment</p>
                      <p className="text-white">{selectedCompany.segment}</p>
                    </div>
                  )}
                  {selectedCompany.ma_track_record && (
                    <div className="col-span-2">
                      <p className="text-gray-500">M&A Track Record</p>
                      <p className="text-white">{selectedCompany.ma_track_record}</p>
                    </div>
                  )}
                  {selectedCompany.portfolio_companies && (
                    <div className="col-span-2">
                      <p className="text-gray-500">Portfolio Companies</p>
                      <p className="text-white">{selectedCompany.portfolio_companies}</p>
                    </div>
                  )}
                  {selectedCompany.deal_structure && (
                    <div>
                      <p className="text-gray-500">Deal Structure</p>
                      <p className="text-white">{selectedCompany.deal_structure}</p>
                    </div>
                  )}
                  {selectedCompany.ebitda_target && (
                    <div>
                      <p className="text-gray-500">EBITDA Target</p>
                      <p className="text-white">{selectedCompany.ebitda_target}</p>
                    </div>
                  )}
                  {selectedCompany.revenue_target && (
                    <div>
                      <p className="text-gray-500">Revenue Target</p>
                      <p className="text-white">{selectedCompany.revenue_target}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                  {(() => {
                    try {
                      const parsed = JSON.parse(selectedCompany.notes || '');
                      if (parsed?.all_contacts?.length > 1) return `Contacts Found (${parsed.all_contacts.length})`;
                    } catch {}
                    return 'Contact Found';
                  })()}
                </h3>
                {editing ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Full name"
                      value={editForm.contact_name}
                      onChange={e => setEditForm(f => ({ ...f, contact_name: e.target.value }))}
                      className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-white text-sm
                        focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Job title"
                      value={editForm.contact_title}
                      onChange={e => setEditForm(f => ({ ...f, contact_title: e.target.value }))}
                      className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-white text-sm
                        focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="LinkedIn URL"
                      value={editForm.contact_linkedin}
                      onChange={e => setEditForm(f => ({ ...f, contact_linkedin: e.target.value }))}
                      className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-white text-sm
                        focus:outline-none focus:border-blue-500"
                    />
                    <textarea
                      placeholder="Notes"
                      value={editForm.notes}
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#333] rounded-lg text-white text-sm
                        focus:outline-none focus:border-blue-500 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveEdit}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                          rounded-lg transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="flex-1 py-2 bg-[#1a1a1a] border border-[#333] text-gray-300 text-sm
                          font-medium rounded-lg hover:bg-[#222] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    {(() => {
                      // Try to parse all_contacts from JSON notes
                      let allContacts: any[] = [];
                      try {
                        const parsed = JSON.parse(selectedCompany.notes || '');
                        if (parsed?.all_contacts) allContacts = parsed.all_contacts;
                      } catch {}

                      if (allContacts.length > 0) {
                        // Show ALL contacts
                        return (
                          <div className="space-y-3">
                            {allContacts.map((contact: any, idx: number) => (
                              <div
                                key={idx}
                                className={`p-3 rounded-lg border ${
                                  idx === 0
                                    ? 'bg-green-500/5 border-green-500/20'
                                    : 'bg-[#0a0a0a] border-[#262626]'
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <p className="text-white font-semibold">
                                      {contact.name}
                                      {idx === 0 && (
                                        <span className="ml-2 text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                                          Best Match
                                        </span>
                                      )}
                                    </p>
                                    <p className="text-gray-300 text-sm mt-0.5">{contact.title || 'No title'}</p>
                                    {contact.company && (
                                      <p className="text-gray-500 text-xs mt-0.5">{contact.company}</p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1.5">
                                      <span className="text-xs text-gray-500">
                                        Score: <span className="text-gray-300">{contact.score}</span>
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        Level: <span className="text-gray-300">{contact.level}</span>
                                      </span>
                                    </div>
                                  </div>
                                  {contact.linkedin && (
                                    <a
                                      href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-400 hover:text-blue-300 ml-2 shrink-0"
                                    >
                                      <Linkedin className="w-5 h-5" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      // Fallback: single contact (old format or no JSON notes)
                      if (selectedCompany.contact_name) {
                        return (
                          <>
                            <p className="text-lg font-semibold text-white">{selectedCompany.contact_name}</p>
                            <p className="text-gray-300">{selectedCompany.contact_title || 'No title'}</p>
                            {selectedCompany.contact_linkedin && (
                              <a
                                href={selectedCompany.contact_linkedin.startsWith('http') ? selectedCompany.contact_linkedin : `https://${selectedCompany.contact_linkedin}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                              >
                                <Linkedin className="w-4 h-4" />
                                View LinkedIn Profile
                              </a>
                            )}
                            {selectedCompany.hierarchy_level && (
                              <p className="text-gray-500">
                                Level: <span className="text-gray-300">{selectedCompany.hierarchy_level}</span>
                              </p>
                            )}
                            {selectedCompany.notes && (
                              <div className="mt-2 p-3 bg-[#0a0a0a] rounded-lg">
                                <p className="text-gray-400">{selectedCompany.notes}</p>
                              </div>
                            )}
                          </>
                        );
                      }

                      return <p className="text-gray-500">No contact found yet</p>;
                    })()}
                  </div>
                )}
              </div>

              {/* Actions */}
              {!editing && (
                <div className="space-y-2">
                  <button
                    onClick={() => handleRetry(selectedCompany.id)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1a1a1a] border border-[#333]
                      text-gray-300 text-sm font-medium rounded-lg hover:bg-[#222] transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry Search
                  </button>
                  <button
                    onClick={() => setEditing(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#1a1a1a] border border-[#333]
                      text-gray-300 text-sm font-medium rounded-lg hover:bg-[#222] transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit Contact
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleMarkStatus(selectedCompany.id, 'found')}
                      className="flex-1 py-2 text-sm font-medium rounded-lg bg-green-500/10 text-green-400
                        border border-green-500/30 hover:bg-green-500/20 transition-colors"
                    >
                      Mark Found
                    </button>
                    <button
                      onClick={() => handleMarkStatus(selectedCompany.id, 'escalation')}
                      className="flex-1 py-2 text-sm font-medium rounded-lg bg-yellow-500/10 text-yellow-400
                        border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors"
                    >
                      Mark Escalation
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
