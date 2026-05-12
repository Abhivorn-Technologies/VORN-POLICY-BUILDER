'use client';

import React, { useState, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import dynamic from 'next/dynamic';
import * as XLSX from 'xlsx';
import 'react-quill-new/dist/quill.snow.css';
import { 
  Plus, Trash2, Download, Eye, EyeOff, Image as ImageIcon, 
  Table as TableIcon, Type, Settings, GripVertical, CheckCircle,
  LayoutTemplate, Sun, Moon, Save, FileOutput, AlertCircle, Check, X, XCircle, FileSpreadsheet
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
  const request = indexedDB.open(DB_NAME, 3);
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
  } catch { return null; }
};

const idbSet = async (key: string, value: unknown) => {
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
  showTableBullets?: boolean;
  tableTitle?: string;
  tableSubtitle?: string;
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

type DialogType = 'ALERT' | 'CONFIRM' | 'PROMPT';

interface DialogState {
  isOpen: boolean;
  type: DialogType;
  title: string;
  message: string;
  inputValue?: string;
  onConfirm: (val?: string) => void;
  onCancel?: () => void;
}

// --- MEMOIZED BLOCK COMPONENT ---
const EditorBlock = React.memo(({ 
  block, idx, isLast, updateBlock, removeBlock, moveBlock, handleBlockImageUpload, handleTableCompanyLogoUpload,
  handleExcelUpload, logoStatuses, handleLogoUrlChange
}: {
  block: Block, idx: number, isLast: boolean,
  updateBlock: (id: string, updates: Partial<Block>) => void,
  removeBlock: (id: string) => void,
  moveBlock: (idx: number, dir: 'UP' | 'DOWN') => void,
  handleBlockImageUpload: (idx: number, e: React.ChangeEvent<HTMLInputElement>) => void,
  handleTableCompanyLogoUpload: (idx: number, cIdx: number, e: React.ChangeEvent<HTMLInputElement>) => void,
  handleExcelUpload: (blockId: string, e: React.ChangeEvent<HTMLInputElement>) => void,
  logoStatuses: Record<string, string>,
  handleLogoUrlChange: (url: string, id: string, callback: (final: string) => void) => Promise<void>
}) => {
  // LOCAL STATE FOR INSTANT FEEDBACK WITHOUT PARENT RE-RENDERS
  const [localHtml, setLocalHtml] = useState(block.htmlContent || '');
  const [localImageUrl, setLocalImageUrl] = useState(block.imageUrl || '');
  const [localWidth, setLocalWidth] = useState(block.imageWidth || 100);
  const [localRadius, setLocalRadius] = useState(block.imageRadius || 0);

  // SOURCE OF TRUTH TRACKING
  const lastId = useRef(block.id);

  // Sync ONLY when the block identity changes (e.g. template loads, deletion, reset)
  // This is the "Overleaf" pattern: don't pull data back down while the user is inside it.
  useEffect(() => {
    if (block.id !== lastId.current) {
      setLocalHtml(block.htmlContent || '');
      setLocalImageUrl(block.imageUrl || '');
      setLocalWidth(block.imageWidth || 100);
      setLocalRadius(block.imageRadius || 0);
      lastId.current = block.id;
    }
  }, [block.id, block.htmlContent, block.imageUrl, block.imageWidth, block.imageRadius]);

  // Handle template/external updates (if the ID is the same but content was forced externally)
  // We check if the local state is wildly different from the prop AND it hasn't matched for a while
  // But for now, we trust the local state during the session.

  // Debounced sync back to parent for PDF and Persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localHtml !== block.htmlContent) updateBlock(block.id, { htmlContent: localHtml });
    }, 1000); // 1s debounce for text
    return () => clearTimeout(timer);
  }, [localHtml, block.id, updateBlock, block.htmlContent]);

  useEffect(() => {
    const timer = setTimeout(() => {
       if (localImageUrl !== block.imageUrl) updateBlock(block.id, { imageUrl: localImageUrl });
       if (localWidth !== block.imageWidth) updateBlock(block.id, { imageWidth: localWidth });
       if (localRadius !== block.imageRadius) updateBlock(block.id, { imageRadius: localRadius });
    }, 500); // 500ms for visual settings
    return () => clearTimeout(timer);
  }, [localImageUrl, localWidth, localRadius, block.id, updateBlock, block.imageUrl, block.imageWidth, block.imageRadius]);

  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 1024 : false;

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
            value={localHtml} 
            onChange={setLocalHtml} 
          />
        )}
        {block.type === 'IMAGE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
              <div style={{ width: isMobile ? '100%' : '200px', height: isMobile ? 'auto' : '200px', minHeight: isMobile ? '160px' : '200px', background: 'white', borderRadius: '12px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {localImageUrl ? <img src={localImageUrl} alt="Block Content" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ImageIcon size={48} color="#94a3b8" />}
              </div>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <label className="label-sm">Image Source</label>
                <input 
                  type="text" 
                  placeholder="URL or Base64..."
                  value={localImageUrl} 
                  onChange={(e) => setLocalImageUrl(e.target.value)}
                  style={{ width: '100%', marginBottom: '16px' }}
                />
                 <label className="action-pill" style={{ marginBottom: '16px' }}>
                  <ImageIcon size={14} /> Upload Local File
                  <input type="file" hidden onChange={(e) => handleBlockImageUpload(idx, e)} />
                </label>
                <label className="label-sm">Width ({localWidth}%)</label>
                <input 
                  type="range" min="10" max="100" 
                  value={localWidth} 
                  onChange={(e) => setLocalWidth(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <label className="label-sm">Corner Radius: {localRadius}px</label>
                <input 
                  type="range" min="0" max="250" value={localRadius}
                  onChange={(e) => setLocalRadius(parseInt(e.target.value))}
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
             <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
               <div style={{ flex: 1, minWidth: '150px' }}>
                 <label className="label-sm">Logo Height: {block.tableLogoSize || 30}px</label>
                 <input type="range" min="20" max="120" value={block.tableLogoSize || 30} onChange={(e) => updateBlock(block.id, { tableLogoSize: parseInt(e.target.value) })} style={{ width: '100%' }} />
               </div>
               <div style={{ flex: 1, minWidth: '150px' }}>
                 <label className="label-sm">Benefit Text Size: {block.tableTextSize || 10}px</label>
                 <input type="range" min="6" max="18" value={block.tableTextSize || 10} onChange={(e) => updateBlock(block.id, { tableTextSize: parseInt(e.target.value) })} style={{ width: '100%' }} />
               </div>
               <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '4px' }}>
                 <label className="label-sm" style={{ marginBottom: 0 }}>Show Bullets</label>
                 <button 
                   onClick={() => updateBlock(block.id, { showTableBullets: block.showTableBullets === undefined ? false : !block.showTableBullets })}
                   style={{ 
                     padding: '4px 12px', borderRadius: '20px', fontSize: '11px',
                     background: (block.showTableBullets !== false) ? '#3b82f6' : '#334155',
                     color: '#fff', border: 'none', cursor: 'pointer',
                     fontWeight: 600
                   }}
                 >
                   {(block.showTableBullets !== false) ? 'YES' : 'NO'}
                 </button>
               </div>
             </div>
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {block.companies.map((c, cIdx) => (
                    <div key={c.id} style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--brand-primary)' }}>PLAN #{cIdx + 1}</span>
                        <button onClick={() => updateBlock(block.id, { companies: block.companies?.filter(comp => comp.id !== c.id) })} className="btn-ghost" style={{ color: '#EF4444' }}><Trash2 size={14}/></button>
                      </div>
                      
                      {/* LOGO PREVIEW */}
                      <div style={{ width: '100%', height: '60px', background: 'white', borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
                        {c.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.logoUrl} alt="Logo" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                        ) : (
                          <ImageIcon size={20} color="#cbd5e1" />
                        )}
                      </div>

                      <input value={c.name} onChange={(e) => {
                        const nc = [...block.companies!];
                        nc[cIdx].name = e.target.value;
                        updateBlock(block.id, { companies: nc });
                      }} style={{ width: '100%', marginBottom: '12px', fontWeight: 700 }} placeholder="Company Name" />
                      <div style={{ position: 'relative' }}>
                        <input value={c.logoUrl} onChange={(e) => {
                           const newUrl = e.target.value;
                           const nc = [...block.companies!];
                           nc[cIdx].logoUrl = newUrl;
                           updateBlock(block.id, { companies: nc });
                           
                           handleLogoUrlChange(newUrl, c.id, (final) => {
                              const nc2 = [...block.companies!];
                              nc2[cIdx].logoUrl = final;
                              updateBlock(block.id, { companies: nc2 });
                           });
                        }} style={{ width: '100%', fontSize: '11px', marginBottom: '8px', paddingRight: '40px' }} placeholder="Logo URL (or Base64)" />
                        
                        {/* MINI BADGE */}
                        <div style={{ position: 'absolute', right: '8px', top: '8px' }}>
                          {logoStatuses[c.id] === 'LOADING' && <div className="animate-spin" style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: 'var(--brand-primary)', borderRadius: '100%' }} />}
                          {logoStatuses[c.id] === 'VERIFIED' && <CheckCircle size={14} color="#10B981" />}
                          {logoStatuses[c.id] === 'WEB_ONLY' && <AlertCircle size={14} color="#F59E0B" />}
                          {logoStatuses[c.id] === 'ERROR' && <XCircle size={14} color="#EF4444" />}
                        </div>
                      </div>

                      {logoStatuses[c.id] === 'WEB_ONLY' && (
                        <div style={{ fontSize: '10px', color: '#F59E0B', background: 'rgba(245,158,11,0.05)', padding: '8px', borderRadius: '4px', marginBottom: '12px', border: '1px solid rgba(245,158,11,0.1)' }}>
                          ⚠️ <strong>Web-Only:</strong> This image works here but is blocked for PDF. Please download and use the &quot;Upload Logo File&quot; button below for a perfect export.
                        </div>
                      )}
                      
                      {logoStatuses[c.id] === 'ERROR' && (
                        <div style={{ fontSize: '10px', color: '#EF4444', background: 'rgba(239,68,68,0.05)', padding: '8px', borderRadius: '4px', marginBottom: '12px', border: '1px solid rgba(239,68,68,0.1)' }}>
                          ❌ <strong>Failed:</strong> Could not load this image URL. Please check the link.
                        </div>
                      )}

                      {logoStatuses[c.id] === 'VERIFIED' && (
                        <div style={{ fontSize: '10px', color: '#10B981', background: 'rgba(16,185,129,0.05)', padding: '8px', borderRadius: '4px', marginBottom: '12px', border: '1px solid rgba(16,185,129,0.1)' }}>
                          ✅ <strong>PDF Ready:</strong> Image successfully processed for export.
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {c.benefits.split('\n').filter(b => b.trim()).map((benefit, bIdx) => {
                          const hasTick = /\[tick\]|\[check\]|\[yes\]/i.test(benefit);
                          const hasCross = /\[cross\]|\[x\]|\[no\]/i.test(benefit);
                          const cleanText = benefit.replace(/\[tick\]|\[check\]|\[yes\]|\[cross\]|\[x\]|\[no\]/gi, '').trim();
                          
                          return (
                            <div key={bIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                              {hasTick ? (
                                <Check size={14} color="#10B981" strokeWidth={3} />
                              ) : hasCross ? (
                                <X size={14} color="#EF4444" strokeWidth={3} />
                              ) : (
                                <span style={{ opacity: 0.5 }}>•</span>
                              )}
                              <span>{cleanText || (hasTick ? 'Yes' : hasCross ? 'No' : benefit)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <textarea value={c.benefits} onChange={(e) => {
                        const nc = [...block.companies!];
                        nc[cIdx].benefits = e.target.value;
                        updateBlock(block.id, { companies: nc });
                      }} rows={4} style={{ width: '100%', fontSize: '12px', marginTop: '8px' }} placeholder="Benefits (one per line, use [tick] or [cross])" />
                      <label className="action-pill" style={{ marginTop: '12px', width: '100%', justifyContent: 'center' }}>
                        <ImageIcon size={14} /> Upload Plan Logo
                        <input type="file" hidden onChange={(e) => handleTableCompanyLogoUpload(idx, cIdx, e)} />
                      </label>
                    </div>
                ))}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '200px' }}>
                  <button 
                    onClick={() => updateBlock(block.id, { companies: [...(block.companies || []), { id: Date.now().toString(), name: 'New Plan', benefits: '', logoUrl: '' }] })}
                    style={{ width: '100%', border: '2px dashed var(--border-subtle)', borderRadius: '12px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '16px', fontWeight: 700 }}
                  >
                    + Add Plan
                  </button>
                  <label style={{ 
                    width: '100%', border: '2px dashed var(--brand-primary)', borderRadius: '12px', 
                    background: 'rgba(59, 130, 246, 0.05)', color: 'var(--brand-primary)', 
                    cursor: 'pointer', padding: '16px', display: 'flex', alignItems: 'center', 
                    justifyContent: 'center', gap: '8px', fontSize: '13px', fontWeight: 700 
                  }}>
                    <TableIcon size={18} /> Import Excel
                    <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={(e) => handleExcelUpload(block.id, e)} />
                  </label>
                </div>
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

  const [logoStatuses, setLogoStatuses] = useState<Record<string, 'LOADING' | 'VERIFIED' | 'WEB_ONLY' | 'ERROR' | ''>>({});
  const [activeTab, setActiveTab] = useState<'blocks' | 'variables' | 'settings' | 'templates'>('blocks');
  const [showPreview, setShowPreview] = useState(true);
  const [baseFontSize, setBaseFontSize] = useState(11);

  const [pageBgColor, setPageBgColor] = useState('#F5F3FF'); // Default to light purple
  const [isMobile, setIsMobile] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<'sidebar' | 'editor' | 'preview'>('editor');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

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
  const [excelPreview, setExcelPreview] = useState<{ isOpen: boolean, data: unknown[][], targetBlockId?: string }>({
    isOpen: false,
    data: [],
  });

  // CUSTOM DIALOG STATE
  const [dialog, setDialog] = useState<DialogState>({
    isOpen: false,
    type: 'ALERT',
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const openDialog = (options: Omit<DialogState, 'isOpen'>) => {
    setDialog({ ...options, isOpen: true });
  };

  const closeDialog = () => {
    setDialog(prev => ({ ...prev, isOpen: false }));
  };

  // SIDEBAR & PREVIEW WIDTHS
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [previewWidth, setPreviewWidth] = useState(450);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  // MOBILE DETECTION
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

  const urlToBase64 = async (url: string): Promise<{ data: string, status: 'VERIFIED' | 'WEB_ONLY' | 'ERROR' }> => {
    if (!url) return { data: '', status: 'ERROR' };
    if (url.startsWith('data:')) return { data: url, status: 'VERIFIED' };
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fetch failed');
      const blob = await response.blob();
      
      // Basic validation that it is an image
      if (!blob.type.startsWith('image/')) {
        return { data: url, status: 'ERROR' };
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { data: base64, status: 'VERIFIED' };
    } catch (e) {
      console.warn('Logo Fetch Info:', e);
      // If we can't fetch it via JS, it's WEB_ONLY (will show in browser but not PDF)
      return { data: url, status: 'WEB_ONLY' };
    }
  };
  useEffect(() => {
    const load = async () => {
      setIsMounted(true);
      
      try {
        // 1. Fast Metadata First
        const savedLogo = localStorage.getItem('pb-logo');
        if (savedLogo) setHeaderLogoUrl(savedLogo);
        setHeaderAlign(localStorage.getItem('pb-logo-align') as 'left' | 'center' | 'right' || 'center');
        setHeaderVAlign(localStorage.getItem('pb-logo-valign') as 'TOP' | 'BOTTOM' || 'TOP');
        
        const savedTheme = localStorage.getItem('pb-theme');
        if (savedTheme) setTheme(savedTheme as 'light' | 'dark');

        const savedBaseFont = localStorage.getItem('pb-base-font');
        if (savedBaseFont) {
          const parsed = parseInt(savedBaseFont);
          if (!isNaN(parsed)) setBaseFontSize(parsed);
        }

        const savedPageColor = localStorage.getItem('pb-page-color');
        if (savedPageColor) setPageBgColor(savedPageColor);

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
        localStorage.setItem('pb-page-color', pageBgColor);

      } catch (e) {
        console.error('Storage Error:', e);

      }
      
      const now = new Date().toLocaleTimeString();
      setLastSaved(prev => prev !== now ? now : prev);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [blocks, headerLogoUrl, headerAlign, headerVAlign, variables, templates, theme, baseFontSize, pageBgColor]);

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

  // AUTO-PROXY LOGO HANDLER
  const handleLogoUrlChange = async (url: string, id: string, callback: (finalUrl: string) => void) => {
    if (!url) {
      callback('');
      setLogoStatuses(prev => ({ ...prev, [id]: '' }));
      return;
    }
    
    callback(url); 
    setLogoStatuses(prev => ({ ...prev, [id]: 'LOADING' }));
    
    const result = await urlToBase64(url);
    setLogoStatuses(prev => ({ ...prev, [id]: result.status }));
    
    if (result.status === 'VERIFIED' && result.data !== url) {
      callback(result.data);
    }
  };

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
    openDialog({
      type: 'CONFIRM',
      title: 'Delete Section?',
      message: 'Are you sure you want to remove this section? This action cannot be undone.',
      onConfirm: () => {
        setBlocks(prev => prev.filter(b => b.id !== id));
        closeDialog();
      },
      onCancel: closeDialog
    });
  }, []);

  const moveBlock = useCallback((idx: number, dir: 'UP' | 'DOWN') => {
    setBlocks(prev => {
      const nextIdx = dir === 'UP' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }, []);

  // HIGH-PERFORMANCE PDF SYNC ENGINE (Debounced)
  const replaceVars = useCallback((text: string) => {
    let result = text;
    variables.forEach(v => {
      const regex = new RegExp(`{{${v.key}}}`, 'g');
      result = result.replace(regex, v.value);
    });
    return result;
  }, [variables]);

  // DEFERRED VALUES FOR PREVIEW
  const deferredBlocks = useDeferredValue(debouncedBlocks);
  const deferredLogo = useDeferredValue(debouncedLogo);

  useEffect(() => {
    if (!isDataLoaded) return;
    const syncTimer = setTimeout(() => setIsSyncing(true), 0);
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
    }, 1500); // 1.5s pause before heavy PDF render
    return () => {
      clearTimeout(syncTimer);
      clearTimeout(timer);
    };
  }, [blocks, headerLogoUrl, replaceVars, isDataLoaded]);

  // TEMPLATE ENGINE
  const handleSaveTemplate = () => {
    openDialog({
      type: 'PROMPT',
      title: 'Save as Template',
      message: 'Enter a name for this template:',
      inputValue: `Template ${new Date().toLocaleDateString()}`,
      onConfirm: (name) => {
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
        closeDialog();
      },
      onCancel: closeDialog
    });
  };

  const loadTemplate = (t: Template) => {
    openDialog({
      type: 'CONFIRM',
      title: 'Load Template',
      message: `Load template "${t.name}"? Current changes will be overwritten.`,
      onConfirm: () => {
        setBlocks(t.blocks);
        setHeaderLogoUrl(t.logo);
        setVariables(t.variables);
        closeDialog();
      },
      onCancel: closeDialog
    });
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

    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result as string);
      const next = [...blocks];
      const companies = [...(next[blockIndex].companies || [])];
      companies[companyIndex].logoUrl = compressed;
      next[blockIndex].companies = companies;
      setBlocks(next);

    };
    reader.readAsDataURL(file);
  };

  const handleExcelUpload = (blockId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const dataBuffer = event.target?.result;
        const wb = XLSX.read(dataBuffer, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as unknown[][];
        
        if (data.length === 0) {
          openDialog({ type: 'ALERT', title: 'Empty File', message: 'The uploaded excel sheet appears to be empty.', onConfirm: closeDialog });
          return;
        }
        
        setExcelPreview({ isOpen: true, data, targetBlockId: blockId });
        e.target.value = ''; // Reset input to allow re-uploading same file
      } catch (err) {
        console.error('Excel Parse Error:', err);
        openDialog({ type: 'ALERT', title: 'Error', message: 'Failed to parse the Excel file. Please ensure it is a valid .xlsx or .xls file.', onConfirm: closeDialog });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmExcelImport = () => {
    try {
      if (excelPreview.data.length === 0) {
        console.warn('Import failed: No data');
        return;
      }

      const allData = excelPreview.data;
      
      // Find the first row that actually has multiple columns (the headers)
      let headerRowIndex = 0;
      while (headerRowIndex < allData.length && (!allData[headerRowIndex] || allData[headerRowIndex].length <= 1)) {
        headerRowIndex++;
      }

      if (headerRowIndex >= allData.length) {
        openDialog({ 
          type: 'ALERT', 
          title: 'Invalid Format', 
          message: 'Could not find a valid data table in the excel sheet. Please ensure you have columns for your plans.', 
          onConfirm: closeDialog 
        });
        return;
      }

      const headers = allData[headerRowIndex];
      const data = allData.slice(headerRowIndex);
      
      // CAPTURE TITLES
      let tableTitle = '';
      let tableSubtitle = '';
      
      // If the first cell of the header row has a title (like the customer name)
      if (headers[0] && String(headers[0]).length > 0) {
        tableTitle = String(headers[0]);
      }
      
      // If there were rows before the header, use them as title/subtitle too
      if (headerRowIndex > 0) {
        if (!tableTitle) tableTitle = String(allData[0][0] || '');
        else tableSubtitle = String(allData[0][0] || '');
      }

      // Capture any intermediate rows as subtitle
      for (let k = 1; k < headerRowIndex; k++) {
        if (allData[k][0]) tableSubtitle += (tableSubtitle ? ' | ' : '') + String(allData[k][0]);
      }

      // NEW: Check if the row immediately after header is a subtitle (only has Col A)
      if (allData.length > 1 && allData[1][0] && !allData[1][1] && !allData[1][2]) {
        tableSubtitle += (tableSubtitle ? ' | ' : '') + String(allData[1][0]);
      }

      const companies: Company[] = [];

      // Map columns to companies
      for (let i = 1; i < headers.length; i++) {
        const name = String(headers[i] || `Plan ${i}`);
        let benefits = '';
        for (let j = 1; j < data.length; j++) {
          const row = data[j];
          if (!row || !Array.isArray(row) || row.length === 0) continue;
          
          const benefitName = String(row[0] || `Feature ${j}`);
          const value = row[i] !== undefined ? String(row[i]) : '';
          
          // SKIP ROWS THAT ARE EMPTY ACROSS ALL PLAN COLUMNS
          const rowValues = row.slice(1);
          const hasAnyValue = rowValues.some(v => v !== undefined && v !== null && String(v).trim() !== '');
          if (!hasAnyValue) continue;

          // Handle boolean-like values for tick/cross
          const valStr = String(value).trim().toLowerCase();
          const isExplicitBoolean = ['yes', 'no', 'true', 'false', 'check', 'tick', 'cross', 'x'].includes(valStr);
          
          if (isExplicitBoolean) {
            if (valStr === 'yes' || valStr === 'true' || valStr === 'check' || valStr === 'tick') {
              benefits += `${benefitName} [tick]\n`;
            } else {
              benefits += `${benefitName} [cross]\n`;
            }
          } else {
            benefits += `${benefitName}: ${value}\n`;
          }
        }
        companies.push({
          id: Date.now().toString() + i + Math.random().toString(36).substr(2, 5),
          name,
          logoUrl: '',
          benefits: benefits.trim()
        });
      }

      if (excelPreview.targetBlockId) {
        updateBlock(excelPreview.targetBlockId, { companies, tableTitle, tableSubtitle });
      } else {
        // Create a new block if imported from sidebar
        const newBlock: Block = {
          id: Date.now().toString(),
          type: 'COMPARISON_TABLE',
          companies: companies,
          tableTitle,
          tableSubtitle,
          tableLogoSize: 30,
          tableTextSize: 10,
          showTableBullets: true
        };
        setBlocks(prev => [...prev, newBlock]);
      }

      setExcelPreview({ isOpen: false, data: [] });
      
      openDialog({
        type: 'ALERT',
        title: 'Import Successful',
        message: `Successfully imported ${companies.length} plans from Excel.`,
        onConfirm: closeDialog
      });
    } catch (err) {
      console.error('Final Import Error:', err);
      openDialog({ type: 'ALERT', title: 'Import Error', message: 'Something went wrong during the final import step.', onConfirm: closeDialog });
    }
  };

  // RENDER (ULTRA-FAST LOADING SCREEN)
  if (!isMounted || !isDataLoaded) {
    return (
      <div suppressHydrationWarning className="flex flex-col items-center justify-center min-h-screen" style={{ background: '#050510', color: '#fff', gap: '32px' }}>
        <div suppressHydrationWarning style={{ position: 'relative', width: '100px', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div suppressHydrationWarning className="absolute inset-0 border-4 border-blue-500/10 rounded-full" style={{ borderStyle: 'dashed' }}></div>
          <div suppressHydrationWarning className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img suppressHydrationWarning src="/icon.png" alt="Sree Insurance" style={{ width: '40px', height: '40px', borderRadius: '8px', zIndex: 2 }} />
        </div>
        <div suppressHydrationWarning style={{ textAlign: 'center' }}>
          <h1 suppressHydrationWarning className="font-title" style={{ fontSize: '24px', letterSpacing: '2px', marginBottom: '8px', opacity: 0.9 }}>SREE INSURANCE</h1>
          <p suppressHydrationWarning className="animate-pulse" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px', color: '#3b82f6', fontWeight: 800 }}>Initializing Premium Engine...</p>
        </div>
        <div suppressHydrationWarning style={{ position: 'fixed', bottom: '40px', fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '1px' }}>SREE INSURANCE SERVICES v2.0</div>
      </div>
    );
  }

  return (
    <div suppressHydrationWarning className={`app-container ${theme}`} style={{ 
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
        
        @media (max-width: 1024px) {
          .desktop-only { display: none !important; }
          .app-main-content { padding: 16px !important; }
          .glass-nav { height: 60px !important; padding: 0 16px !important; }
          .glass-nav h2 { fontSize: 16px !important; }
          .glass-nav p { display: none; }
          .sidebar-panel, .preview-panel { 
            position: fixed; top: 60px; left: 0; right: 0; bottom: 60px;
            width: 100% !important; z-index: 50; background: var(--bg-primary);
          }
        }
        @media (min-width: 1025px) {
          .mobile-only { display: none !important; }
        }
      `}} />
      {/* PREMIUM NAVBAR */}
      <nav className="glass-nav" style={{ height: '70px', display: 'flex', alignItems: 'center', padding: '0 32px', justifyContent: 'space-between', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px', borderRadius: '12px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="Sree Insurance Logo" style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'contain' }} />
          </div>
          <div>
            <h2 className="font-title" style={{ fontSize: isMobile ? '16px' : '22px' }}>Sree Insurance <span style={{ color: 'var(--brand-primary)' }}>Services</span></h2>
            {!isMobile && <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>PREMIUM DOCUMENT ENGINE</p>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '20px' }}>
          {!isMobile && lastSaved && <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle size={14} color="#10B981" /> Auto-saved</div>}
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="btn-ghost" style={{ padding: isMobile ? '8px' : '10px' }}>
              {theme === 'dark' ? <Sun size={isMobile ? 18 : 20} /> : <Moon size={isMobile ? 18 : 20} />}
            </button>
            {!isMobile && <div style={{ width: '1px', height: '24px', background: 'var(--border-subtle)', margin: '0 8px' }} />}
            
            {isMounted && (
              <PDFDownloadLink 
                document={<PDFDocument blocks={debouncedBlocks} headerLogo={debouncedLogo} headerAlign={headerAlign} headerVAlign={headerVAlign} baseFontSize={baseFontSize} pageBgColor={pageBgColor} orientation={orientation} />} 
                fileName="PolicyProposal.pdf"
                className="btn-primary"
                style={{ padding: isMobile ? '10px 14px' : '12px 24px', fontSize: isMobile ? '11px' : '13px' }}
              >
                {({ loading }) => (
                  <>
                    <Download size={isMobile ? 14 : 18} />
                    {loading ? (isMobile ? '...' : 'Preparing...') : (isMobile ? 'PDF' : 'Download PDF')}
                  </>
                )}
              </PDFDownloadLink>
            )}
          </div>
        </div>
      </nav>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* SIDEBAR PANEL */}
        {(!isMobile || mobileActivePanel === 'sidebar') && (
          <aside 
            className="sidebar-panel"
            style={{ 
              width: isMobile ? '100%' : sidebarWidth, 
              minWidth: isMobile ? 'none' : '280px', 
              borderRight: isMobile ? 'none' : '1px solid var(--border-subtle)', 
              background: 'var(--bg-secondary)', 
              display: 'flex', 
              flexDirection: 'column', 
              overflowY: 'auto'
            }}
          >
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {headerLogoUrl ? <img src={headerLogoUrl} alt="Header Logo" style={{ maxHeight: '40px', maxWidth: '100%', objectFit: 'contain' }} /> : <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px' }}>No Logo</div>}
                </div>
                <label className="action-pill" style={{ marginBottom: '12px' }}>
                  <ImageIcon size={14} /> Upload Logo File
                  <input type="file" hidden onChange={handleHeaderLogoUpload} />
                </label>
                  <div style={{ marginBottom: '32px' }}>
                    <div style={{ position: 'relative' }}>
                      <input 
                        value={headerLogoUrl} 
                        onChange={(e) => handleLogoUrlChange(e.target.value, 'header-logo', setHeaderLogoUrl)}
                        placeholder="or paste Logo URL here..." 
                        style={{ width: '100%', fontSize: '11px', padding: '8px', borderRadius: '8px', paddingRight: '40px' }}
                      />
                      <div style={{ position: 'absolute', right: '8px', top: '8px' }}>
                        {logoStatuses['header-logo'] === 'LOADING' && <div className="animate-spin" style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: 'var(--brand-primary)', borderRadius: '100%' }} />}
                        {logoStatuses['header-logo'] === 'VERIFIED' && <CheckCircle size={14} color="#10B981" />}
                        {logoStatuses['header-logo'] === 'WEB_ONLY' && <AlertCircle size={14} color="#F59E0B" />}
                        {logoStatuses['header-logo'] === 'ERROR' && <XCircle size={14} color="#EF4444" />}
                      </div>
                    </div>
                  </div>

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
                  <label className="side-btn" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <FileSpreadsheet size={18} /> Excel Import
                    <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={(e) => handleExcelUpload('', e)} />
                  </label>
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
                            openDialog({
                              type: 'CONFIRM',
                              title: 'Delete Template?',
                              message: `Are you sure you want to delete "${t.name}"?`,
                              onConfirm: () => {
                                const updated = templates.filter(temp => temp.id !== t.id);
                                setTemplates(updated);
                                localStorage.setItem('pb-templates', JSON.stringify(updated));
                                closeDialog();
                              },
                              onCancel: closeDialog
                            });
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

                  <div className="side-label" style={{ marginTop: '24px' }}>Page Orientation</div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    {(['portrait', 'landscape'] as const).map(o => (
                      <button 
                        key={o}
                        onClick={() => setOrientation(o)}
                        style={{ 
                          flex: 1, padding: '12px', borderRadius: '12px', 
                          background: orientation === o ? 'var(--brand-primary)' : 'var(--bg-primary)',
                          color: orientation === o ? 'white' : 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)', cursor: 'pointer',
                          fontSize: '11px', fontWeight: 700
                        }}
                      >
                        {o.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  <div className="side-label" style={{ marginTop: '12px' }}>Page Background</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => setPageBgColor('#FFFFFF')} 
                      style={{ 
                        flex: 1, padding: '12px', borderRadius: '12px', 
                        background: pageBgColor === '#FFFFFF' ? 'var(--brand-primary)' : 'var(--bg-primary)',
                        color: pageBgColor === '#FFFFFF' ? 'white' : 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)', cursor: 'pointer',
                        fontSize: '11px', fontWeight: 700
                      }}
                    >
                      Clean White
                    </button>
                    <button 
                      onClick={() => setPageBgColor('#F5F3FF')} 
                      style={{ 
                        flex: 1, padding: '12px', borderRadius: '12px', 
                        background: pageBgColor === '#F5F3FF' ? 'var(--brand-primary)' : '#F5F3FF',
                        color: pageBgColor === '#F5F3FF' ? 'white' : '#7C3AED',
                        border: '1px solid var(--border-subtle)', cursor: 'pointer',
                        fontSize: '11px', fontWeight: 700
                      }}
                    >
                      Premium Purple
                    </button>
                  </div>
               </div>
            )}
          </div>
        </aside>
      )}

        {/* RESIZER 1 */}
        {!isMobile && (
          <div onMouseDown={() => setIsResizingSidebar(true)} style={{ width: '4px', cursor: 'col-resize', background: isResizingSidebar ? 'var(--brand-primary)' : 'transparent', zIndex: 10 }} />
        )}        {/* MAIN EDITOR */}
        {(!isMobile || mobileActivePanel === 'editor') && (
          <main className="app-main-content" style={{ 
            flex: 1, 
            overflowY: 'auto', 
            padding: isMobile ? '20px' : '32px 40px', 
            background: 'var(--bg-primary)', 
            position: 'relative',
            scrollBehavior: 'smooth'
          }}>
            <div style={{ 
              maxWidth: showPreview ? '850px' : '1080px', 
              margin: '0 auto', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: isMobile ? '20px' : '32px',
              transition: 'max-width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' 
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-end', 
                marginBottom: '8px',
                paddingBottom: '16px',
                borderBottom: '1px solid var(--border-subtle)'
              }}>
                <div>
                  <h2 className="font-title" style={{ fontSize: isMobile ? '16px' : '24px', marginBottom: '4px' }}>Document Editor</h2>
                  {lastSaved && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle size={12} color="#10B981" /> 
                      Last changes saved at {lastSaved}
                    </div>
                  )}
                </div>
                {!isMobile && (
                  <button 
                    onClick={() => setShowPreview(!showPreview)} 
                    className="btn-ghost" 
                    style={{ 
                      fontSize: '12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px',
                      padding: '8px 16px',
                      borderRadius: '10px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      fontWeight: 600
                    }}
                  >
                    {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                  </button>
                )}
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
                  handleExcelUpload={handleExcelUpload}
                  logoStatuses={logoStatuses}
                  handleLogoUrlChange={handleLogoUrlChange}
                />
              ))}
              
              <div style={{ display: (activeTab === 'settings' ? 'block' : 'none') as React.CSSProperties['display'] }}>
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
                      <label className="side-label"><LayoutTemplate size={14} /> Page Background</label>
                      <div className="editor-card" style={{ padding: '24px', display: 'flex', gap: '24px' }}>
                        <button 
                          onClick={() => setPageBgColor('#FFFFFF')}
                          style={{ 
                            flex: 1, height: '40px', borderRadius: '8px', 
                            background: 'white', color: '#1e293b', border: pageBgColor === '#FFFFFF' ? '2px solid var(--brand-primary)' : '1px solid #e2e8f0',
                            fontSize: '11px', fontWeight: 800, cursor: 'pointer'
                          }}
                        >
                          WHITE
                        </button>
                        <button 
                          onClick={() => setPageBgColor('#F5F3FF')}
                          style={{ 
                            flex: 1, height: '40px', borderRadius: '8px', 
                            background: '#F5F3FF', color: '#7c3aed', border: pageBgColor === '#F5F3FF' ? '2px solid var(--brand-primary)' : '1px solid #ddd6fe',
                            fontSize: '11px', fontWeight: 800, cursor: 'pointer'
                          }}
                        >
                          PURPLE
                        </button>
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
              </div>
              
              <button 
                onClick={() => addBlock('RICHTEXT')} 
                style={{ 
                  padding: '24px', 
                  border: '2px dashed var(--border-subtle)', 
                  borderRadius: '16px', 
                  background: 'rgba(255,255,255,0.02)', 
                  color: 'var(--text-muted)', 
                  cursor: 'pointer', 
                  fontWeight: 600, 
                  transition: 'all 0.3s ease',
                  marginTop: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px'
                }}
                className="hover-brand-glow"
              >
                <Plus size={24} style={{ opacity: 0.5 }} />
                <span style={{ fontSize: '13px' }}>Add a new section from the sidebar or click here for Text</span>
              </button>
            </div>
          </main>
        )}

        {/* RESIZER 2 */}
        {showPreview && !isMobile && (
          <div onMouseDown={() => setIsResizingPreview(true)} style={{ width: '4px', cursor: 'col-resize', background: isResizingPreview ? 'var(--brand-primary)' : 'transparent', zIndex: 10 }} />
        )}

        {/* LIVE PREVIEW PANEL */}
        {showPreview && (!isMobile || mobileActivePanel === 'preview') && (
          <aside 
            className="preview-panel"
            style={{ 
              width: isMobile ? '100%' : previewWidth, 
              minWidth: isMobile ? 'none' : '400px', 
              background: 'var(--bg-secondary)', 
              borderLeft: isMobile ? 'none' : '1px solid var(--border-subtle)', 
              display: 'flex', 
              flexDirection: 'column' 
            }}
          >
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>LIVE PDF PREVIEW</span>
               {!isMobile && <button onClick={() => setShowPreview(false)} className="btn-ghost" style={{ padding: '4px' }}><EyeOff size={16}/></button>}
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
               <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#fff' }}>
                  <PDFViewer width="100%" height="100%" style={{ border: 'none' }} showToolbar={false}>
                    <PDFDocument 
                      blocks={deferredBlocks} 
                      headerLogo={deferredLogo} 
                      headerAlign={headerAlign} 
                      headerVAlign={headerVAlign}
                      baseFontSize={baseFontSize}
                      pageBgColor={pageBgColor}
                      orientation={orientation}
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

      {/* MOBILE BOTTOM NAVIGATION */}
      {isMobile && (
        <div style={{ 
          height: '60px', 
          background: 'var(--glass-bg)', 
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--border-subtle)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-around',
          zIndex: 100 
        }}>
          {(['sidebar', 'editor', 'preview'] as const).map(panel => (
            <button
              key={panel}
              onClick={() => setMobileActivePanel(panel)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: 'transparent',
                border: 'none',
                color: mobileActivePanel === panel ? 'var(--brand-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {panel === 'sidebar' && <LayoutTemplate size={20} />}
              {panel === 'editor' && <Type size={20} />}
              {panel === 'preview' && <Eye size={20} />}
              <span style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase' }}>{panel === 'sidebar' ? 'Assets' : panel}</span>
            </button>
          ))}
        </div>
      )}

      {/* EXCEL PREVIEW MODAL */}
      {excelPreview.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: theme === 'dark' ? '#1e293b' : '#ffffff',
            borderRadius: '24px',
            width: '90%', maxWidth: '900px', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 800 }}>Excel Data Preview</h3>
              <button onClick={() => setExcelPreview({ isOpen: false, data: [] })} className="btn-ghost"><X size={20} /></button>
            </div>
            
            <div style={{ flex: 1, overflow: 'auto', padding: '32px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {excelPreview.data[0]?.map((h, i) => (
                      <th key={i} style={{ padding: '12px', textAlign: 'left', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', fontWeight: 800 }}>{String(h || '')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {excelPreview.data.slice(1).map((row, ri) => (
                    <tr key={ri}>
                      {Array.isArray(row) && row.map((cell, ci) => (
                        <td key={ci} style={{ padding: '12px', border: '1px solid var(--border-subtle)' }}>{String(cell !== undefined ? cell : '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '24px 32px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '16px', justifyContent: 'flex-end', background: 'var(--bg-secondary)' }}>
              <button onClick={() => setExcelPreview({ isOpen: false, data: [] })} className="btn-ghost" style={{ padding: '12px 24px', borderRadius: '12px' }}>Cancel</button>
              <button 
                onClick={confirmExcelImport}
                style={{ 
                  padding: '12px 32px', borderRadius: '12px', 
                  background: 'var(--brand-primary)', color: 'white', 
                  fontWeight: 700, border: 'none', cursor: 'pointer'
                }}
              >
                Import into Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM GLASSMORPHIC DIALOG */}
      {dialog.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: theme === 'dark' ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '24px',
            width: '90%', maxWidth: '400px',
            padding: '32px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            animation: 'modalSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
          }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '12px', color: 'var(--text-primary)' }}>{dialog.title}</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>{dialog.message}</p>
            
            {dialog.type === 'PROMPT' && (
              <input 
                autoFocus
                value={dialog.inputValue}
                onChange={(e) => setDialog(prev => ({ ...prev, inputValue: e.target.value }))}
                style={{ 
                  width: '100%', padding: '12px 16px', borderRadius: '12px', 
                  marginBottom: '24px', background: 'rgba(0,0,0,0.05)',
                  fontSize: '15px'
                }}
                onKeyDown={(e) => e.key === 'Enter' && dialog.onConfirm(dialog.inputValue)}
              />
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              {(dialog.type === 'CONFIRM' || dialog.type === 'PROMPT') && (
                <button 
                  onClick={dialog.onCancel} 
                  className="btn-ghost" 
                  style={{ padding: '12px 24px', borderRadius: '12px', fontWeight: 600 }}
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={() => dialog.onConfirm(dialog.inputValue)}
                style={{ 
                  padding: '12px 24px', borderRadius: '12px', 
                  background: 'var(--brand-primary)', color: 'white', 
                  fontWeight: 700, border: 'none', cursor: 'pointer',
                  boxShadow: '0 8px 16px -4px rgba(59, 130, 246, 0.4)'
                }}
              >
                {dialog.type === 'ALERT' ? 'Got it' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ANIMATIONS */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalSlideUp { 
          from { opacity: 0; transform: translateY(20px) scale(0.95); } 
          to { opacity: 1; transform: translateY(0) scale(1); } 
        }
        .hover-brand-glow:hover {
          background: rgba(59, 130, 246, 0.05) !important;
          border-color: var(--brand-primary) !important;
          color: var(--brand-primary) !important;
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.1);
          transform: translateY(-2px);
        }
        .hover-brand-glow:hover svg {
          opacity: 1 !important;
          transform: scale(1.1);
          transition: all 0.3s ease;
        }
      `}} />
    </div>
  );
}
