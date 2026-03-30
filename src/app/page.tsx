'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileSpreadsheet, Bot, BarChart3, Check, Loader2, List } from 'lucide-react';
import { parseExcelBuffer } from '@/lib/excel-parser';
import { ParsedCompany } from '@/lib/types';

type InputMode = 'excel' | 'text';

export default function HomePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState('');
  const [strategic, setStrategic] = useState<ParsedCompany[]>([]);
  const [financial, setFinancial] = useState<ParsedCompany[]>([]);
  const [parsed, setParsed] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Text input state
  const [textInput, setTextInput] = useState('');
  const [defaultType, setDefaultType] = useState<'Strategic' | 'PE'>('Strategic');

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.endsWith('.xlsx')) {
      alert('Please upload an .xlsx file');
      return;
    }
    setFile(f);
    setProjectName(f.name.replace(/\.xlsx$/i, ''));
    setParsing(true);

    try {
      const buffer = await f.arrayBuffer();
      const result = parseExcelBuffer(buffer);
      setStrategic(result.strategic);
      setFinancial(result.financial);
      setParsed(true);
    } catch (err) {
      console.error('Parse error:', err);
      alert('Error parsing Excel file. Please check the format.');
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleParseText = () => {
    const lines = textInput
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      alert('Please enter at least one company name');
      return;
    }

    const companies: ParsedCompany[] = lines.map(line => {
      // Support format: "Company Name | website.com" or "Company Name, website.com" or just "Company Name"
      const parts = line.split(/[|,\t]/).map(p => p.trim());
      const companyName = parts[0];
      const website = parts[1] || undefined;

      return {
        company_name: companyName,
        buyer_type: defaultType,
        website,
      };
    });

    if (defaultType === 'Strategic') {
      setStrategic(companies);
      setFinancial([]);
    } else {
      setFinancial(companies);
      setStrategic([]);
    }

    setParsed(true);
  };

  const handleConfirm = async () => {
    if (!projectName.trim()) return;
    setCreating(true);

    try {
      const companies = [...strategic, ...financial];
      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName.trim(), companies }),
      });

      if (!res.ok) throw new Error('Failed to create project');
      const { project_id } = await res.json();
      router.push(`/project/${project_id}`);
    } catch (err) {
      console.error('Create error:', err);
      alert('Error creating project. Please try again.');
      setCreating(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsed(false);
    setStrategic([]);
    setFinancial([]);
    setProjectName('');
    setTextInput('');
  };

  const total = strategic.length + financial.length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#1a1a1a] px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6 text-blue-500" />
          <span className="text-xl font-bold text-white">DealScout</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        {/* Input Card */}
        <div className="w-full max-w-xl bg-[#141414] border border-[#262626] rounded-xl p-8 space-y-6">
          {!parsed ? (
            <>
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold text-white">Add your buyer list</h1>
                <p className="text-sm text-gray-400">
                  Paste company names directly or upload an Excel file.
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex bg-[#0a0a0a] border border-[#262626] rounded-lg overflow-hidden">
                <button
                  onClick={() => setInputMode('text')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    inputMode === 'text'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-[#1a1a1a]'
                  }`}
                >
                  <List className="w-4 h-4" />
                  Paste List
                </button>
                <button
                  onClick={() => setInputMode('excel')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    inputMode === 'excel'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-[#1a1a1a]'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Upload Excel
                </button>
              </div>

              {inputMode === 'text' ? (
                <>
                  {/* Buyer Type Selector */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">Buyer type</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDefaultType('Strategic')}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          defaultType === 'Strategic'
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                            : 'bg-[#0a0a0a] text-gray-400 border-[#333] hover:border-[#555]'
                        }`}
                      >
                        Strategic
                      </button>
                      <button
                        onClick={() => setDefaultType('PE')}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          defaultType === 'PE'
                            ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                            : 'bg-[#0a0a0a] text-gray-400 border-[#333] hover:border-[#555]'
                        }`}
                      >
                        PE / Financial
                      </button>
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">
                      Company names <span className="text-gray-500 font-normal">(one per line)</span>
                    </label>
                    <textarea
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      rows={8}
                      className="w-full px-4 py-3 bg-[#0a0a0a] border border-[#333] rounded-lg text-white text-sm
                        placeholder:text-gray-500 focus:outline-none focus:border-blue-500 transition-colors
                        resize-none font-mono"
                      placeholder={`Danaher | danaher.com\nThermo Fisher | thermofisher.com\nAbbott Laboratories\nBecton Dickinson`}
                    />
                    <p className="text-xs text-gray-500">
                      Optionally add website after a pipe: Company Name | website.com
                    </p>
                  </div>

                  {/* Project Name */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">Project name</label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#333] rounded-lg text-white
                        placeholder:text-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="e.g. Project Alpha Buyers"
                    />
                  </div>

                  {/* Start Button */}
                  <button
                    onClick={handleParseText}
                    disabled={!textInput.trim() || !projectName.trim()}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50
                      disabled:cursor-not-allowed text-white font-semibold rounded-lg
                      transition-colors"
                  >
                    Start Research
                  </button>
                </>
              ) : (
                <>
                  {/* Drop Zone */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    className={`
                      border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
                      transition-all duration-200
                      ${dragOver
                        ? 'border-blue-500 bg-blue-500/10'
                        : file
                          ? 'border-green-500/50 bg-green-500/5'
                          : 'border-[#333] hover:border-[#555] hover:bg-[#1a1a1a]'
                      }
                    `}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />
                    {parsing ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                        <p className="text-sm text-gray-400">Parsing Excel file...</p>
                      </div>
                    ) : file ? (
                      <div className="flex flex-col items-center gap-3">
                        <Check className="w-10 h-10 text-green-500" />
                        <p className="text-sm text-white font-medium">{file.name}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <Upload className="w-10 h-10 text-gray-500" />
                        <p className="text-sm text-gray-400">
                          Drag & drop your .xlsx file here, or click to browse
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Preview */}
              <div className="text-center space-y-2">
                <Check className="w-10 h-10 text-green-500 mx-auto" />
                <h2 className="text-xl font-bold text-white">
                  {total} {total === 1 ? 'company' : 'companies'} ready
                </h2>
                <p className="text-sm text-gray-400">
                  {strategic.length > 0 && <><span className="text-white font-semibold">{strategic.length}</span> strategic</>}
                  {strategic.length > 0 && financial.length > 0 && ' and '}
                  {financial.length > 0 && <><span className="text-white font-semibold">{financial.length}</span> PE/financial</>}
                  {' '}buyers
                </p>
              </div>

              {/* Project Name (if not already set from text mode) */}
              {inputMode === 'excel' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">Project name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[#0a0a0a] border border-[#333] rounded-lg text-white
                      placeholder:text-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Enter project name"
                  />
                </div>
              )}

              {/* Confirm Button */}
              <button
                onClick={handleConfirm}
                disabled={creating || !projectName.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50
                  disabled:cursor-not-allowed text-white font-semibold rounded-lg
                  transition-colors flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating project...
                  </>
                ) : (
                  'Confirm & Start Research'
                )}
              </button>

              {/* Reset */}
              <button
                onClick={handleReset}
                className="w-full text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Start over
              </button>
            </>
          )}
        </div>

        {/* How it works */}
        <div className="w-full max-w-4xl mt-20 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: <List className="w-8 h-8 text-blue-500" />,
              title: 'Add Companies',
              desc: 'Paste company names directly or upload an Excel with your buyer list',
            },
            {
              icon: <Bot className="w-8 h-8 text-blue-500" />,
              title: 'AI Research',
              desc: 'Claude searches LinkedIn and company websites following M&A hierarchy rules',
            },
            {
              icon: <BarChart3 className="w-8 h-8 text-blue-500" />,
              title: 'Export',
              desc: 'Download a clean Excel with contacts ready for outreach',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="bg-[#141414] border border-[#262626] rounded-xl p-6 text-center space-y-3"
            >
              <div className="flex justify-center">{item.icon}</div>
              <h3 className="text-lg font-semibold text-white">{item.title}</h3>
              <p className="text-sm text-gray-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1a1a1a] py-6 text-center">
        <p className="text-sm text-gray-500">
          Powered by Claude API &middot; Built for M&amp;A professionals
        </p>
      </footer>
    </div>
  );
}
