'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import dynamic from 'next/dynamic';
import 'react-quill-new/dist/quill.snow.css';
import { 
  Plus, Trash2, Download, Printer, Eye, EyeOff, Image as ImageIcon, 
  Table as TableIcon, Type, Settings, Layers, GripVertical, CheckCircle,
  LayoutTemplate, Sun, Moon, Save, FileOutput, AlertCircle
} from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { PDFDocument } from './PDFDocument';

// Dynamic imports to avoid SSR issues
const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });
const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFViewer),
  { ssr: false }
);

// --- NATIVE INDEXEDDB HELPER ---
const DB_NAME = 'PolicyBuilderDB';
const STORE_NAME = 'blocks';
const dbPromise = typeof window !== 'undefined' ? new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
}) : null;

const idbGet = async (key: string) => {
  try {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
};

const idbSet = async (key: string, value: any) => {
  try {
    const db = await dbPromise;
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
  } catch (e) { console.error('IDB Error', e); }
};

// --- TYPES ---
type BlockType = 'RICHTEXT' | 'IMAGE' | 'COMPARISON_TABLE' | 'PAGE_BREAK';

interface Company {
  id: string;
  name: string;
  logoUrl: string;
  benefits: string;
}

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }],
    [{ 'size': ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    [{ 'align': [] }],
    ['link', 'image'],
    ['clean']
  ],
};

const quillFormats = [
  'header', 'size',
  'bold', 'italic', 'underline', 'strike',
  'list', 'align',
  'link', 'image'
];

interface Block {
  id: string;
  type: BlockType;
  htmlContent?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageAlign?: 'left' | 'center' | 'right';
  imageRadius?: number;
  isBackground?: boolean;
  companies?: Company[];
  tableLogoSize?: number;
  tableTextSize?: number;
}

interface Variable {
  key: string;
  value: string;
}

interface Template {
  id: string;
  name: string;
  blocks: Block[];
  logo: string;
  variables: Variable[];
}

// --- MEMOIZED BLOCK COMPONENT ---
const EditorBlock = React.memo(({ 
  block, idx, isLast, updateBlock, removeBlock, moveBlock, handleBlockImageUpload, handleTableCompanyLogoUpload 
}: {
  block: Block, idx: number, isLast: boolean,
  updateBlock: (id: string, updates: Partial<Block>) => void,
  removeBlock: (id: string) => void,
  moveBlock: (idx: number, dir: 'UP' | 'DOWN') => void,
  handleBlockImageUpload: (idx: number, e: any) => void,
  handleTableCompanyLogoUpload: (idx: number, cIdx: number, e: any) => void
}) => {
  return (
    <div className="editor-card animate-fade">
      <div className="block-head">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <GripVertical size={16} color="var(--text-muted)" />
          <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{block.type.replace('_', ' ')}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => moveBlock(idx, 'UP')} disabled={idx === 0} className="btn-ghost" style={{ padding: '4px' }}>▲</button>
          <button onClick={() => moveBlock(idx, 'DOWN')} disabled={isLast} className="btn-ghost" style={{ padding: '4px' }}>▼</button>
          <button onClick={() => removeBlock(block.id)} className="btn-ghost" style={{ color: '#EF4444', padding: '4px' }}><Trash2 size={16} /></button>
        </div>
      </div>
      <div style={{ padding: '24px' }}>
        {block.type === 'RICHTEXT' && (
          <ReactQuill 
            theme="snow"
            modules={quillModules}
            formats={quillFormats}
            value={block.htmlContent} 
            onChange={(v) => updateBlock(block.id, { htmlContent: v })} 
          />
        )}
        {block.type === 'IMAGE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '32px' }}>
              <div style={{ width: '200px', height: '200px', background: 'white', borderRadius: '12px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {block.imageUrl ? <img src={block.imageUrl} alt="Block Content" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ImageIcon size={48} color="#94a3b8" />}
              </div>
              <div style={{ flex: 1 }}>
                <label className="label-sm">Image Source</label>
                <input 
                  type="text" 
                  placeholder="URL or Base64..."
                  value={block.imageUrl} 
                  onChange={(e) => updateBlock(block.id, { imageUrl: e.target.value })}
                  style={{ width: '100%', marginBottom: '16px' }}
                />
                 <label className="action-pill" style={{ marginBottom: '16px' }}>
                  <ImageIcon size={14} /> Upload Local File
                  <input type="file" hidden onChange={(e) => handleBlockImageUpload(idx, e)} />
                </label>
                <label className="label-sm">Width ({block.imageWidth || 100}%)</label>
                <input 
                  type="range" min="10" max="100" 
                  value={block.imageWidth || 100} 
                  onChange={(e) => updateBlock(block.id, { imageWidth: parseInt(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
              <div style={{ flex: 1 }}>
                <label className="label-sm">Corner Radius: {block.imageRadius}px</label>
                <input 
                  type="range" min="0" max="250" value={block.imageRadius || 0}
                  onChange={(e) => updateBlock(block.id, { imageRadius: parseInt(e.target.value) })}
                  className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label className="label-sm" style={{ marginBottom: 0 }}>Background Mode</label>
                <button 
                  onClick={() => updateBlock(block.id, { isBackground: !block.isBackground })}
                  style={{ 
                    padding: '4px 12px', borderRadius: '20px', fontSize: '11px',
                    background: block.isBackground ? '#3b82f6' : '#334155',
                    color: '#fff', border: 'none', cursor: 'pointer'
                  }}
                >
                  {block.isBackground ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
          </div>
        )}
        {block.type === 'COMPARISON_TABLE' && block.companies && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
             <div style={{ display: 'flex', gap: '20px' }}>
               <div style={{ flex: 1 }}>
                 <label className="label-sm">Logo Height: {block.tableLogoSize || 30}px</label>
                 <input type="range" min="20" max="120" value={block.tableLogoSize || 30} onChange={(e) => updateBlock(block.id, { tableLogoSize: parseInt(e.target.value) })} style={{ width: '100%' }} />
               </div>
               <div style={{ flex: 1 }}>
                 <label className="label-sm">Benefit Text Size: {block.tableTextSize || 10}px</label>
                 <input type="range" min="6" max="18" value={block.tableTextSize || 10} onChange={(e) => updateBlock(block.id, { tableTextSize: parseInt(e.target.value) })} style={{ width: '100%' }} />
               </div>
             </div>
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {block.companies.map((c, cIdx) => (
                    <div key={c.id} style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--brand-primary)' }}>PLAN #{cIdx + 1}</span>
                        <button onClick={() => updateBlock(block.id, { companies: block.companies?.filter(comp => comp.id !== c.id) })} className="btn-ghost" style={{ color: '#EF4444' }}><Trash2 size={14}/></button>
                      </div>
                      <input value={c.name} onChange={(e) => {
                        const nc = [...block.companies!];
                        nc[cIdx].name = e.target.value;
                        updateBlock(block.id, { companies: nc });
                      }} style={{ width: '100%', marginBottom: '12px', fontWeight: 700 }} placeholder="Company Name" />
                      <input value={c.logoUrl} onChange={(e) => {
                         const nc = [...block.companies!];
                         nc[cIdx].logoUrl = e.target.value;
                         updateBlock(block.id, { companies: nc });
                      }} style={{ width: '100%', fontSize: '11px', marginBottom: '12px' }} placeholder="Logo URL" />
                      <textarea value={c.benefits} onChange={(e) => {
                        const nc = [...block.companies!];
                        nc[cIdx].benefits = e.target.value;
                        updateBlock(block.id, { companies: nc });
                      }} rows={4} style={{ width: '100%', fontSize: '12px' }} placeholder="Benefits (one per line)" />
                      <label className="action-pill" style={{ marginTop: '12px', width: '100%', justifyContent: 'center' }}>
                        <ImageIcon size={14} /> Upload Plan Logo
                        <input type="file" hidden onChange={(e) => handleTableCompanyLogoUpload(idx, cIdx, e)} />
                      </label>
                    </div>
                ))}
                <button 
                  onClick={() => updateBlock(block.id, { companies: [...(block.companies || []), { id: Date.now().toString(), name: 'New Plan', benefits: '', logoUrl: '' }] })}
                  style={{ minWidth: '200px', border: '2px dashed var(--border-subtle)', borderRadius: '12px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  + Add Plan
                </button>
             </div>
          </div>
        )}
      </div>
    </div>
  );
});
EditorBlock.displayName = 'EditorBlock';

export default function PolicyEditor() {
  // THEME & PERSISTENCE
  const [isMounted, setIsMounted] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [lastSaved, setLastSaved] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'blocks' | 'variables' | 'settings' | 'templates'>('blocks');
  const [showPreview, setShowPreview] = useState(true);
  const [baseFontSize, setBaseFontSize] = useState(11);
  const [quotaError, setQuotaError] = useState(false);

  // CORE STATE
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [debouncedBlocks, setDebouncedBlocks] = useState<Block[]>([]);
  const [headerLogoUrl, setHeaderLogoUrl] = useState('');
  const [debouncedLogo, setDebouncedLogo] = useState('');
  const [headerAlign, setHeaderAlign] = useState<'left' | 'right' | 'center'>('left');
  const [headerVAlign, setHeaderVAlign] = useState<'TOP' | 'BOTTOM'>('TOP');
  const [variables, setVariables] = useState<Variable[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // SIDEBAR & PREVIEW WIDTHS
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [previewWidth, setPreviewWidth] = useState(450);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  // UTILS: Image Compression
  const compressImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_WIDTH = 1200;
        if (width > MAX_WIDTH) {
          height = (MAX_WIDTH / width) * height;
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8)); // 80% quality is perfect balance
      };
      img.src = dataUrl;
    });
  };

  // OPTIMIZED LOAD (Triage Metadata vs Heavy Content)
  useEffect(() => {
    const load = async () => {
      setIsMounted(true);
      
      try {
        // 1. Fast Metadata First
        const savedLogo = localStorage.getItem('pb-logo');
        if (savedLogo) setHeaderLogoUrl(savedLogo);
        setHeaderAlign(localStorage.getItem('pb-logo-align') as any || 'center');
        setHeaderVAlign(localStorage.getItem('pb-logo-valign') as any || 'TOP');
        
        const savedTheme = localStorage.getItem('pb-theme');
        if (savedTheme) setTheme(savedTheme as 'light' | 'dark');

        const savedBaseFont = localStorage.getItem('pb-base-font');
        if (savedBaseFont) {
          const parsed = parseInt(savedBaseFont);
          if (!isNaN(parsed)) setBaseFontSize(parsed);
        }

        // 2. Heavy Document Data Next
        const [savedBlocks, savedVariables, savedTemplates] = await Promise.all([
          idbGet('pb-blocks'),
          idbGet('pb-variables'),
          idbGet('pb-templates')
        ]) as [Block[] | null, Variable[] | null, Template[] | null];

        if (savedBlocks && Array.isArray(savedBlocks)) setBlocks(savedBlocks);
        else setBlocks([{ id: '1', type: 'RICHTEXT', htmlContent: '<h1>Policy Proposal</h1><p>Start editing your professional insurance proposal here...</p>' }]);
        
        if (savedVariables) setVariables(savedVariables);
        else setVariables([{ key: 'CustomerName', value: 'Valued Client' }, { key: 'PolicyNumber', value: 'PB-2024-001' }]);

        if (savedTemplates) setTemplates(savedTemplates);
        
      } catch (e) {
        console.error('Initial Load Error:', e);
      } finally {
        setIsDataLoaded(true);
      }
    };
    load();
  }, []);

  // AUTO SAVE Trigger
  useEffect(() => {
    if (blocks.length === 0) return;
    
    const timeoutId = setTimeout(async () => {
      try {
        await idbSet('pb-blocks', blocks);
        await idbSet('pb-variables', variables);
        await idbSet('pb-templates', templates);
        
        localStorage.setItem('pb-logo', headerLogoUrl);
        localStorage.setItem('pb-logo-align', headerAlign);
        localStorage.setItem('pb-logo-valign', headerVAlign);
        localStorage.setItem('pb-theme', theme);
        localStorage.setItem('pb-base-font', baseFontSize.toString());
        setQuotaError(false);
      } catch (e) {
        console.error('Storage Error:', e);
        setQuotaError(true);
      }
      
      const now = new Date().toLocaleTimeString();
      setLastSaved(prev => prev !== now ? now : prev);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [blocks, headerLogoUrl, headerAlign, headerVAlign, variables, theme, baseFontSize]);

  // RESIZING LOGIC
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        setSidebarWidth(Math.max(200, Math.min(500, e.clientX)));
      }
      if (isResizingPreview) {
        setPreviewWidth(Math.max(300, Math.min(800, window.innerWidth - e.clientX)));
      }
    };
    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingPreview(false);
    };
    if (isResizingSidebar || isResizingPreview) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar, isResizingPreview]);

  // HANDLERS (Memoized)
  const updateBlock = useCallback((id: string, updates: Partial<Block>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  }, []);

  const addBlock = useCallback((type: BlockType) => {
    const id = Date.now().toString();
    const newBlock: Block = { 
      id, type, 
      htmlContent: type === 'RICHTEXT' ? '<p>New section...</p>' : undefined,
      imageWidth: 60,
      imageAlign: 'center',
      imageRadius: 8,
      isBackground: false,
      companies: type === 'COMPARISON_TABLE' ? [] : undefined
    };
    setBlocks(prev => [...prev, newBlock]);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
  }, []);

  const moveBlock = useCallback((idx: number, dir: 'UP' | 'DOWN') => {
    const nextIdx = dir === 'UP' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
    setBlocks(next);
  }, [blocks.length]);

  // HIGH-PERFORMANCE PDF SYNC ENGINE (Debounced)
  const replaceVars = useCallback((text: string) => {
    let result = text;
    variables.forEach(v => {
      const regex = new RegExp(`{{${v.key}}}`, 'g');
      result = result.replace(regex, v.value);
    });
    return result;
  }, [variables]);

  useEffect(() => {
    if (!isDataLoaded) return;
    setIsSyncing(true);
    const timer = setTimeout(() => {
      const prepared = blocks.map(b => ({
        ...b,
        htmlContent: b.htmlContent ? replaceVars(b.htmlContent) : undefined,
        companies: b.companies?.map(c => ({
          ...c,
          name: replaceVars(c.name),
          benefits: replaceVars(c.benefits)
        }))
      }));
      setDebouncedBlocks(prepared);
      setDebouncedLogo(headerLogoUrl);
      setIsSyncing(false);
    }, 1200); // 1.2s pause before heavy PDF render
    return () => clearTimeout(timer);
  }, [blocks, headerLogoUrl, replaceVars, isDataLoaded]);

  // TEMPLATE ENGINE
  const handleSaveTemplate = () => {
    const name = prompt("Enter Template Name:");
    if (!name) return;
    const newTemp: Template = {
      id: Date.now().toString(),
      name,
      blocks,
      logo: headerLogoUrl,
      variables
    };
    const updated = [...templates, newTemp];
    setTemplates(updated);
    localStorage.setItem('pb-templates', JSON.stringify(updated));
  };

  const loadTemplate = (t: Template) => {
    if (confirm(`Load template "${t.name}"? Current changes will be overwritten.`)) {
      setBlocks(t.blocks);
      setHeaderLogoUrl(t.logo);
      setVariables(t.variables);
    }
  };

  // TEMPLATE ENGINE

  const handleHeaderLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      setHeaderLogoUrl(compressed);
    };
    reader.readAsDataURL(file);
  };

  const handleBlockImageUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      const next = [...blocks];
      next[index].imageUrl = compressed;
      setBlocks(next);
    };
    reader.readAsDataURL(file);
  };

  const handleTableCompanyLogoUpload = async (blockIndex: number, companyIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      const next = [...blocks];
      const companies = [...(next[blockIndex].companies || [])];
      companies[companyIndex].logoUrl = compressed;
      next[blockIndex].companies = companies;
      setBlocks(next);
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  // RENDER (ULTRA-FAST LOADING SCREEN)
  if (!isMounted || !isDataLoaded) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen" style={{ background: '#050510', color: '#fff', gap: '32px' }}>
        <div style={{ position: 'relative', width: '80px', height: '80px' }}>
          <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 className="font-title" style={{ fontSize: '24px', letterSpacing: '4px', marginBottom: '8px', opacity: 0.9 }}>VORN</h1>
          <p className="animate-pulse" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px', color: '#3b82f6', fontWeight: 800 }}>Initializing Premium Engine...</p>
        </div>
        <div style={{ position: 'fixed', bottom: '40px', fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '1px' }}>VORN OPTIMIZED v2.0</div>
      </div>
    );
  }

  return (
    <div className={`app-container ${theme}`} style={{ 
      background: theme === 'dark' ? '#050510' : '#f8fafc',
      color: theme === 'dark' ? '#f8fafc' : '#0f172a',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden' // Root container should not scroll
    }}>
      {/* GLOBAL CSS RESET FOR BROWSER UNITY AND ZOOM SYNC */}
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --brand-primary: #3b82f6;
        }
        .app-container.dark {
          --bg-primary: #050510;
          --bg-secondary: #0f172a;
          --bg-card: #1e293b;
          --text-primary: #f8fafc;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --border-subtle: rgba(255,255,255,0.06);
          --glass-bg: rgba(15, 23, 42, 0.8);
        }
        .app-container.light {
          --bg-primary: #f8fafc;
          --bg-secondary: #f1f5f9;
          --bg-card: #ffffff;
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --text-muted: #94a3b8;
          --border-subtle: rgba(0,0,0,0.06);
          --glass-bg: rgba(255, 255, 255, 0.8);
        }
        .ql-editor { 
          font-family: 'Helvetica', 'Arial', sans-serif !important; 
          font-size: ${baseFontSize}px !important;
          line-height: 1.3 !important;
          color: var(--text-primary) !important;
          padding: 20px !important;
        }
        .ql-editor h1 { font-size: 24px !important; font-weight: 700 !important; margin-bottom: 10px !important; }
        .ql-editor h2 { font-size: 18px !important; font-weight: 700 !important; margin-top: 15px !important; margin-bottom: 8px !important; }
        .ql-editor h3 { font-size: 14px !important; font-weight: 700 !important; margin-top: 10px !important; margin-bottom: 5px !important; }
        .ql-editor p { margin-bottom: 5px !important; }
        .editor-card { 
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          content-visibility: auto; 
          contain-intrinsic-size: 200px;
          will-change: transform, opacity;
        }
        .glass-nav {
          background: var(--glass-bg);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border-subtle);
        }
        .btn-ghost {
          color: var(--text-secondary);
        }
        .btn-ghost:hover {
          background: var(--border-subtle);
          color: var(--text-primary);
        }
        .label-sm {
          color: var(--text-muted);
        }
        input, textarea, select {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }
        .app-main-content {
          scrollbar-width: thin;
          scrollbar-color: var(--text-muted) transparent;
          scroll-behavior: smooth;
        }
        * { box-sizing: border-box; }
      `}} />
      {/* PREMIUM NAVBAR */}
      <nav className="glass-nav" style={{ height: '70px', display: 'flex', alignItems: 'center', padding: '0 32px', justifyContent: 'space-between', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: 'var(--brand-primary)', padding: '10px', borderRadius: '10px' }}>
            <LayoutTemplate size={22} color="white" />
          </div>
          <div>
            <h2 className="font-title" style={{ fontSize: '22px' }}>PolicyBuilder <span style={{ color: 'var(--brand-primary)' }}>SaaS</span></h2>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>PROFESSIONAL POLICY DESIGNER</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {lastSaved && <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle size={14} color="#10B981" /> Auto-saved</div>}
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="btn-ghost">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <div style={{ width: '1px', height: '24px', background: 'var(--border-subtle)', margin: '0 8px' }} />
            
            {isMounted && (
              <PDFDownloadLink 
                document={<PDFDocument blocks={debouncedBlocks} headerLogo={debouncedLogo} headerAlign={headerAlign} headerVAlign={headerVAlign} baseFontSize={baseFontSize} />} 
                fileName="PolicyProposal.pdf"
                className="btn-primary"
              >
                {({ loading }) => (
                  <>
                    <Download size={18} />
                    {loading ? 'Preparing...' : 'Download PDF'}
                  </>
                )}
              </PDFDownloadLink>
            )}
          </div>
        </div>
      </nav>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* SIDEBAR */}
        <aside style={{ width: sidebarWidth, minWidth: '280px', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
            {(['blocks', 'variables', 'settings', 'templates'] as const).map(tab => (
              <button 
                key={tab} 
                onClick={() => setActiveTab(tab)} 
                style={{ 
                  flex: 1, padding: '16px', border: 'none', background: 'transparent',
                  color: activeTab === tab ? 'var(--brand-primary)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab ? '2px solid var(--brand-primary)' : 'none',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize'
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ padding: '24px' }}>
            {activeTab === 'blocks' && (
              <div className="animate-fade">
                <div className="side-label"><ImageIcon size={14} /> Global Logo</div>
                <div style={{ background: '#fff', borderRadius: '12px', padding: '12px', marginBottom: '16px', border: '1px solid var(--border-subtle)' }}>
                  {headerLogoUrl ? <img src={headerLogoUrl} alt="Header Logo" style={{ maxHeight: '40px', maxWidth: '100%', objectFit: 'contain' }} /> : <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px' }}>No Logo</div>}
                </div>
                <label className="action-pill" style={{ marginBottom: '32px' }}>
                  <ImageIcon size={14} /> Change Logo
                  <input type="file" hidden onChange={handleHeaderLogoUpload} />
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <label className="label-sm">Position</label>
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    {(['left', 'center', 'right'] as const).map(a => (
                      <button 
                        key={a} 
                        onClick={() => setHeaderAlign(a)} 
                        style={{ flex: 1, padding: '6px', fontSize: '10px', fontWeight: 800, borderRadius: '6px', background: headerAlign === a ? 'var(--bg-primary)' : 'transparent', color: headerAlign === a ? 'var(--brand-primary)' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
                      >
                        {a.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    {(['TOP', 'BOTTOM'] as const).map(a => (
                      <button 
                        key={a} 
                        onClick={() => setHeaderVAlign(a)} 
                        style={{ flex: 1, padding: '6px', fontSize: '10px', fontWeight: 800, borderRadius: '6px', background: headerVAlign === a ? 'var(--bg-primary)' : 'transparent', color: headerVAlign === a ? 'var(--brand-primary)' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button onClick={() => addBlock('RICHTEXT')} className="side-btn"><Type size={18} /> Text Block</button>
                  <button onClick={() => addBlock('IMAGE')} className="side-btn"><ImageIcon size={18} /> Image Block</button>
                  <button onClick={() => addBlock('COMPARISON_TABLE')} className="side-btn"><TableIcon size={18} /> Comparison Table</button>
                  <button onClick={() => addBlock('PAGE_BREAK')} className="side-btn"><FileOutput size={18} /> Page Break</button>
                </div>
              </div>
            )}

            {activeTab === 'variables' && (
              <div className="animate-fade">
                <div className="side-label"><Settings size={14} /> Smart Variables</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                  {variables.map((v, i) => (
                    <div key={i} style={{ padding: '12px', background: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                         <input 
                          value={v.key} 
                          onChange={(e) => {
                            const next = [...variables];
                            next[i].key = e.target.value;
                            setVariables(next);
                          }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--brand-primary)', fontWeight: 800, fontSize: '11px', width: '80%' }}
                        />
                        <button onClick={() => setVariables(variables.filter((_, idx) => idx !== i))} style={{ background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer' }}><Trash2 size={12}/></button>
                      </div>
                      <input 
                        value={v.value} 
                        onChange={(e) => {
                          const next = [...variables];
                          next[i].value = e.target.value;
                          setVariables(next);
                        }}
                        placeholder="Value..."
                        style={{ width: '100%', padding: '6px', fontSize: '12px' }}
                      />
                    </div>
                  ))}
                  <button onClick={() => setVariables([...variables, { key: 'NewKey', value: '' }])} className="side-btn"><Plus size={14} /> Add Variable</button>
                </div>
              </div>
            )}

            {activeTab === 'templates' && (
              <div className="animate-fade">
                <div className="side-label"><Save size={14} /> Saved Templates</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                  {templates.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '40px' }}>No templates found.</div>}
                  {templates.map(t => (
                    <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-primary)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                       <span style={{ fontSize: '13px', fontWeight: 600 }}>{t.name}</span>
                       <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => loadTemplate(t)} className="btn-ghost" title="Load" style={{ padding: '4px' }}><FileOutput size={14}/></button>
                          <button onClick={() => {
                            const updated = templates.filter(temp => temp.id !== t.id);
                            setTemplates(updated);
                            localStorage.setItem('pb-templates', JSON.stringify(updated));
                          }} className="btn-ghost" title="Delete" style={{ color: '#EF4444', padding: '4px' }}><Trash2 size={14}/></button>
                       </div>
                    </div>
                  ))}
                  <button onClick={handleSaveTemplate} className="side-btn"><Save size={14} /> Save Current as Template</button>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
               <div className="animate-fade">
                  <div className="side-label"><Settings size={14} /> Document Settings</div>
                  <div className="editor-card" style={{ padding: '20px' }}>
                    <label className="label-sm">Base Font Size: {baseFontSize}px</label>
                    <input 
                      type="range" min="8" max="24" 
                      value={baseFontSize} 
                      onChange={(e) => setBaseFontSize(parseInt(e.target.value))} 
                      style={{ width: '100%' }} 
                    />
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                      This scales all text in the document proportionately.
                    </p>
                  </div>
               </div>
            )}
          </div>
        </aside>

        {/* RESIZER */}
        <div onMouseDown={() => setIsResizingSidebar(true)} style={{ width: '4px', cursor: 'col-resize', background: isResizingSidebar ? 'var(--brand-primary)' : 'transparent', zIndex: 10 }} />

        {/* MAIN EDITOR */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '60px', background: 'var(--bg-primary)', position: 'relative' }}>
          <div style={{ maxWidth: '850px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 className="font-title" style={{ fontSize: '20px' }}>Document Editor</h2>
              <button 
                onClick={() => setShowPreview(!showPreview)} 
                className="btn-ghost" 
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>

            {blocks.map((block, idx) => (
              <EditorBlock 
                key={block.id}
                block={block}
                idx={idx}
                isLast={idx === blocks.length - 1}
                updateBlock={updateBlock}
                removeBlock={removeBlock}
                moveBlock={moveBlock}
                handleBlockImageUpload={handleBlockImageUpload}
                handleTableCompanyLogoUpload={handleTableCompanyLogoUpload}
              />
            ))}
            
            {activeTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
                 <div>
                   <label className="side-label"><Settings size={14} /> Global Styling</label>
                   <div className="editor-card" style={{ padding: '24px' }}>
                     <label className="label-sm">Base Font Size: {baseFontSize}px</label>
                     <input 
                        type="range" min="8" max="24" value={baseFontSize} 
                        onChange={(e) => setBaseFontSize(parseInt(e.target.value))} 
                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                     />
                     <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>This scales all text in the document proportionately.</p>
                   </div>
                 </div>

                 <div>
                   <label className="side-label"><Sun size={14} /> Appearance</label>
                   <div className="editor-card" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span className="label-sm" style={{ marginBottom: 0 }}>Dark Mode</span>
                     <button 
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        style={{ padding: '8px 16px', borderRadius: '8px', background: 'var(--brand-primary)', color: 'white' }}
                     >
                        {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
                     </button>
                   </div>
                 </div>
              </div>
            )}
            
            <button 
              onClick={() => addBlock('RICHTEXT')} 
              style={{ padding: '32px', border: '2px dashed var(--border-subtle)', borderRadius: '16px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
              className="hover-brand"
            >
              + Click to add another section from the sidebar
            </button>
          </div>
        </main>

        {/* RESIZER 2 */}
        {showPreview && (
          <div onMouseDown={() => setIsResizingPreview(true)} style={{ width: '4px', cursor: 'col-resize', background: isResizingPreview ? 'var(--brand-primary)' : 'transparent', zIndex: 10 }} />
        )}

        {/* LIVE PREVIEW PANEL */}
        {showPreview && (
          <aside style={{ width: previewWidth, minWidth: '400px', background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>LIVE PDF PREVIEW</span>
               <button onClick={() => setShowPreview(false)} className="btn-ghost" style={{ padding: '4px' }}><EyeOff size={16}/></button>
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
               <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#fff' }}>
                  <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar={false}>
                    <PDFDocument 
                      blocks={debouncedBlocks} 
                      headerLogo={debouncedLogo} 
                      headerAlign={headerAlign} 
                      headerVAlign={headerVAlign}
                      baseFontSize={baseFontSize}
                    />
                  </PDFViewer>

                  {/* SMART SYNC INDICATOR OVERLAY */}
                  {isSyncing && (
                    <div style={{ 
                      position: 'absolute', top: '12px', right: '12px', 
                      background: 'var(--brand-primary)', color: 'white', 
                      padding: '6px 12px', borderRadius: '4px', fontSize: '9px', fontWeight: 800,
                      display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                      zIndex: 100
                    }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '100%', background: 'white', opacity: 0.8 }} />
                      UPDATING PREVIEW...
                    </div>
                  )}
                  
                  {/* Subtle overlay hint */}
                  {!blocks.length && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.9)', color: '#1e293b', fontSize: '13px', fontWeight: 600, pointerEvents: 'none' }}>
                      <div style={{ textAlign: 'center' }}>
                        <Download size={32} style={{ marginBottom: '12px', color: 'var(--brand-primary)' }} />
                        <p>Preview is optimized for the final download.</p>
                      </div>
                    </div>
                  )}
               </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
