'use client';

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Font, Svg, Path } from '@react-pdf/renderer';

// Register Fonts for a premium look
Font.register({
  family: 'Inter',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf' },
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf', fontWeight: 700 },
  ],
});

Font.register({
  family: 'Outfit',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/fontsource/fonts/outfit@latest/latin-700-normal.ttf', fontWeight: 700 },
  ],
});

const getInitials = (name: string) => {
  if (!name) return 'PL';
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().substring(0, 2);
};

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontFamily: 'Helvetica', // Default to safe built-in font
    fontSize: 11,
    color: '#1e293b',
  },
  header: {
    position: 'absolute',
    top: 30,
    left: 60,
    right: 60,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 40,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 60,
    right: 60,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  logo: {
    height: 30,
    objectFit: 'contain',
  },
  content: {
    marginTop: 30,
  },
  paragraph: {
    marginBottom: 2,
    lineHeight: 1.1,
    fontFamily: 'Helvetica',
  },
  h1: {
    fontSize: 24,
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 0,
    marginBottom: 8,
    fontFamily: 'Helvetica',
  },
  h2: {
    fontSize: 18,
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 0,
    marginBottom: 6,
    fontFamily: 'Helvetica',
  },
  h3: {
    fontSize: 14,
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 0,
    marginBottom: 4,
    fontFamily: 'Helvetica',
  },
  h4: {
    fontSize: 12,
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 8,
    marginBottom: 4,
    fontFamily: 'Helvetica',
  },
  h5: {
    fontSize: 10,
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 6,
    marginBottom: 3,
    fontFamily: 'Helvetica',
  },
  h6: {
    fontSize: 9,
    fontWeight: 700,
    color: '#1e293b',
    marginTop: 4,
    marginBottom: 2,
    fontFamily: 'Helvetica',
  },
  image: {
    borderRadius: 8,
    marginBottom: 10,
  },
  table: {
    display: 'flex',
    width: '100%',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 10,
  },
  tableRow: {
    flexDirection: 'row',
    width: '100%',
    borderBottomColor: '#e2e8f0',
    borderBottomWidth: 1,
    minHeight: 30, // Prevent zero-height rows
  },
  tableHeader: {
    backgroundColor: '#f8fafc',
  },
  tableCell: {
    flex: 1,
    padding: 4,
    borderRightColor: '#e2e8f0',
    borderRightWidth: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  lastCell: {
    borderRightWidth: 0,
  },
  tableName: {
    fontSize: 10,
    fontWeight: 700,
    marginTop: 4,
    textAlign: 'center',
    color: '#1e293b',
  },
  tableLogo: {
    objectFit: 'contain',
    width: 60,
  },
  tableLogoFallback: {
    width: 60,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 2,
    paddingLeft: 4,
  },
  bullet: {
    width: 8,
    fontSize: 11,
  },
  listText: {
    flex: 1,
    fontSize: 10,
  },
});

// --- NAN SHIELD 2.0 ---
const cleanStyle = (style: any) => {
  const result = { ...style };
  Object.keys(result).forEach(key => {
    const val = result[key];
    if (typeof val === 'number' && !isFinite(val)) {
      if (key === 'fontSize') result[key] = 11;
      else if (key === 'lineHeight') result[key] = 1.2;
      else result[key] = 0;
    }
  });
  return result;
};

// Helper to clean HTML and extract text/tags
const cleanHTML = (html: string) => {
  if (typeof window === 'undefined') return html;
  return html.replace(/&nbsp;/g, ' ')
             .replace(/<font[^>]*>/gi, '')
             .replace(/<\/font>/gi, '');
};

// --- MEMOIZED PDF BLOCK ---
const PDFBlock = React.memo(({ block, styles, cleanStyle }: { block: Block, styles: any, cleanStyle: (s: any) => any }) => {
  const parsedContent = React.useMemo(() => {
    if (block.type !== 'RICHTEXT') return null;
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHTML(block.htmlContent || ''), 'text/html');
    
    const walk = (node: Node, style: any, key: string): React.ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        return text ? <Text key={key} style={style}>{text}</Text> : null;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        let currentStyle = { ...style };
        const tag = el.tagName.toLowerCase();

        if (tag === 'strong' || tag === 'b') currentStyle.fontWeight = 700;
        if (tag === 'em' || tag === 'i') currentStyle.fontStyle = 'italic';
        if (tag === 'u') currentStyle.textDecoration = 'underline';
        if (el.classList.contains('ql-size-small')) currentStyle.fontSize = 8;
        if (el.classList.contains('ql-size-large')) currentStyle.fontSize = 16;
        if (el.classList.contains('ql-size-huge')) currentStyle.fontSize = 24;
        if (el.classList.contains('ql-align-center')) currentStyle.textAlign = 'center';
        if (el.classList.contains('ql-align-right')) currentStyle.textAlign = 'right';
        if (el.classList.contains('ql-align-justify')) currentStyle.textAlign = 'justify';
        if (el.style.textAlign) currentStyle.textAlign = el.style.textAlign;

        if (tag === 'h1') currentStyle = { ...currentStyle, ...styles.h1, textAlign: currentStyle.textAlign };
        if (tag === 'h2') currentStyle = { ...currentStyle, ...styles.h2, textAlign: currentStyle.textAlign };
        if (tag === 'h3') currentStyle = { ...currentStyle, ...styles.h3, textAlign: currentStyle.textAlign };

        if (tag === 'img') {
          const src = el.getAttribute('src');
          if (src) return <Image key={key} src={src} style={cleanStyle({ width: '100%', marginTop: 8, marginBottom: 8 })} />;
        }
        if (tag === 'br') return <Text key={key}>{'\n'}</Text>;

        const blocks: React.ReactNode[] = [];
        let currentTextRun: React.ReactNode[] = [];
        const flushText = (k: string) => {
          if (currentTextRun.length > 0) {
            blocks.push(<Text key={`textrun-${k}`} style={cleanStyle(currentStyle)}>{currentTextRun}</Text>);
            currentTextRun = [];
          }
        };

        Array.from(el.childNodes).forEach((child, i) => {
          const k = `${key}-${i}`;
          if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === 'img') {
            flushText(k);
            blocks.push(walk(child, currentStyle, k));
          } else if (child.nodeType === Node.TEXT_NODE) {
            currentTextRun.push(child.textContent);
          } else {
            const rendered = walk(child, currentStyle, k);
            if (rendered) currentTextRun.push(rendered);
          }
        });
        flushText(key);

        const isBlock = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'li'].includes(tag);
        if (isBlock) {
          return (
            <View key={key} style={tag === 'li' ? cleanStyle(styles.listItem) : cleanStyle({ marginBottom: 2, textAlign: currentStyle.textAlign })}>
              {tag === 'li' && <Text style={cleanStyle(styles.bullet)}>•</Text>}
              <View style={{ flexDirection: 'column', width: '100%' }}>{blocks}</View>
            </View>
          );
        }
        return <React.Fragment key={key}>{blocks}</React.Fragment>;
      }
      return null;
    };

    const content: React.ReactNode[] = [];
    Array.from(doc.body.childNodes).forEach((node, i) => {
      const rendered = walk(node, styles.paragraph, `root-${i}`);
      if (rendered) content.push(rendered);
    });

    return (
      <View style={{ marginTop: 20 }}>
        {content}
      </View>
    );
  }, [block.htmlContent, styles, cleanStyle]);

  if (block.type === 'RICHTEXT') {
    return parsedContent;
  }

  if (block.type === 'IMAGE' && block.imageUrl) {
    const safeNum = (val: any, fallback: number) => {
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return (typeof n === 'number' && isFinite(n)) ? n : fallback;
    };
    const imgStyle = [
       styles.image, 
       { 
         width: `${safeNum(block.imageWidth, 100)}%`, 
         borderRadius: safeNum(block.imageRadius, 0) 
       }
    ];
    if (block.isBackground) {
      return (
        <Image 
          src={block.imageUrl} 
          style={[
            ...imgStyle, 
            { position: 'absolute', top: 100, left: '10%', width: '80%', opacity: 0.15, zIndex: -1 }
          ]} 
        />
      );
    }
    return (
      <View style={{ alignItems: (block.imageAlign as any) || 'center', marginTop: 20 }}>
        <Image src={block.imageUrl} style={imgStyle} />
      </View>
    );
  }

  if (block.type === 'COMPARISON_TABLE' && block.companies) {
    const safeNum = (val: any, fallback: number) => {
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return (typeof n === 'number' && isFinite(n)) ? n : fallback;
    };
    return (
      <View key={block.id} style={{ marginBottom: 20 }}>
        {/* TABLE TITLE & SUBTITLE */}
        {block.tableTitle && (
          <Text style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, textAlign: 'center', color: '#1e293b' }}>
            {block.tableTitle}
          </Text>
        )}
        {block.tableSubtitle && (
          <Text style={{ fontSize: 10, fontWeight: 400, marginBottom: 12, textAlign: 'center', color: '#64748b' }}>
            {block.tableSubtitle}
          </Text>
        )}

        <View style={[styles.table, { marginTop: 20 }]}>
          {/* Header Row: Features Label + Plan Names */}
          <View style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.tableCell, { flex: 1.5, backgroundColor: '#f1f5f9' }]}>
              <Text style={[styles.tableName, { fontWeight: 900 }]}>FEATURES</Text>
            </View>
            {block.companies.map((c, idx) => (
              <View key={c.id} style={[styles.tableCell, idx === block.companies!.length - 1 && styles.lastCell, { alignItems: 'center' }]}>
                <View style={{ height: safeNum(block.tableLogoSize, 30), marginBottom: 4, alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                  {c.logoUrl && c.logoUrl.startsWith('data:') ? (
                    <Image src={c.logoUrl} style={[styles.tableLogo, { height: safeNum(block.tableLogoSize, 30), width: 'auto' }]} />
                  ) : (
                    <View style={[styles.tableLogoFallback, { height: safeNum(block.tableLogoSize, 30) }]}>
                      <Text style={styles.fallbackText}>{getInitials(c.name || 'PL')}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.tableName}>{c.name}</Text>
              </View>
            ))}
          </View>

          {/* Data Rows: Feature Name + Values for each plan */}
          {(() => {
            // Extract unique feature names from all companies
            const featureNames: string[] = [];
            block.companies.forEach(c => {
              c.benefits.split('\n').forEach(line => {
                const name = line.replace(/\[tick\]|\[check\]|\[yes\]|\[cross\]|\[x\]|\[no\]/gi, '').split(':')[0].trim();
                if (name && !featureNames.includes(name)) featureNames.push(name);
              });
            });

            return featureNames.map((fName, fIdx) => (
              <View key={fIdx} style={styles.tableRow} wrap={false}>
                {/* Feature Label Column */}
                <View style={[styles.tableCell, { flex: 1.5, backgroundColor: '#f8fafc' }]}>
                  <Text style={[styles.listText, { fontWeight: 700, fontSize: safeNum(block.tableTextSize, 9) }]}>{fName}</Text>
                </View>
                
                {/* Value Columns for each plan */}
                {block.companies.map((c, cIdx) => {
                  const line = c.benefits.split('\n').find(l => l.includes(fName)) || '';
                  const hasTick = /\[tick\]|\[check\]|\[yes\]/i.test(line);
                  const hasCross = /\[cross\]|\[x\]|\[no\]/i.test(line);
                  const valPart = line.includes(':') ? line.split(':')[1].trim() : '';

                  return (
                    <View key={cIdx} style={[styles.tableCell, cIdx === block.companies.length - 1 && styles.lastCell, { alignItems: 'center', justifyContent: 'center' }]}>
                      {hasTick ? (
                        <Svg width="10" height="10" viewBox="0 0 24 24">
                          <Path d="M20 6L9 17l-5-5" stroke="#10B981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      ) : hasCross ? (
                        <Svg width="10" height="10" viewBox="0 0 24 24">
                          <Path d="M18 6L6 18M6 6l12 12" stroke="#EF4444" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      ) : (
                        <Text style={[styles.listText, { fontSize: safeNum(block.tableTextSize, 9) }]}>{valPart}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ));
          })()}
        </View>
      </View>
    );
  }
  return null;
});
PDFBlock.displayName = 'PDFBlock';

interface Company {
  id: string;
  name: string;
  benefits: string;
  logoUrl?: string;
}

interface Block {
  id: string;
  type: string;
  htmlContent?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageRadius?: number;
  imageAlign?: string;
  isBackground?: boolean;
  companies?: Company[];
  showTableBullets?: boolean;
  tableTitle?: string;
  tableSubtitle?: string;
}

interface PDFDocumentProps {
  blocks: Block[];
  headerLogo?: string;
  headerAlign?: 'left' | 'center' | 'right';
  headerVAlign?: 'TOP' | 'BOTTOM';
  baseFontSize?: number;
  pageBgColor?: string;
  orientation?: 'portrait' | 'landscape';
}

export const PDFDocument = ({ 
  blocks, headerLogo, headerAlign, headerVAlign, 
  baseFontSize = 11, pageBgColor = '#F5F3FF', 
  orientation = 'portrait' 
}: PDFDocumentProps) => {
  // Split blocks into physical pages
  const pages: Block[][] = [];
  let currentPage: Block[] = [];
  
  blocks.forEach(block => {
    if (block.type === 'PAGE_BREAK') {
      if (currentPage.length > 0) pages.push(currentPage);
      currentPage = [];
    } else {
      currentPage.push(block);
    }
  });
  if (currentPage.length > 0) pages.push(currentPage);
  if (pages.length === 0) pages.push([]); // Handle empty case

  const safeNum = (val: any, fallback: number) => {
    const n = typeof val === 'string' ? parseFloat(val) : val;
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  };

  return (
    <Document>
      {pages.map((pBlocks, pIdx) => {
        const hasWideTable = pBlocks.some(b => b.type === 'COMPARISON_TABLE' && (b.companies?.length || 0) > 3);
        const pageOrientation = hasWideTable ? 'landscape' : orientation;

        return (
          <Page key={pIdx} size="A4" orientation={pageOrientation} style={[styles.page, { fontSize: safeNum(baseFontSize, 11), backgroundColor: pageBgColor }]}>
            {headerLogo && headerVAlign !== 'BOTTOM' && (
              <View fixed style={[styles.header, { justifyContent: headerAlign === 'center' ? 'center' : headerAlign === 'right' ? 'flex-end' : 'flex-start' }]}>
                <Image src={headerLogo} style={styles.logo} />
              </View>
            )}

            {headerLogo && headerVAlign === 'BOTTOM' && (
              <View fixed style={[styles.footer, { justifyContent: headerAlign === 'center' ? 'center' : headerAlign === 'right' ? 'flex-end' : 'flex-start' }]}>
                <Image src={headerLogo} style={styles.logo} />
              </View>
            )}

            <View style={styles.content}>
              {pBlocks.map((block: Block) => (
                <PDFBlock 
                  key={block.id} 
                  block={block} 
                  styles={styles} 
                  cleanStyle={cleanStyle} 
                />
              ))}
            </View>
          </Page>
        );
      })}
    </Document>
  );
};
