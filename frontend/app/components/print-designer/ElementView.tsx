'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { resolveUploadUrl } from '@/lib/assets';
import { fillTokens, tokensIn } from '@/lib/print-designer/fields';
import { FONT_STACK, type FontFamily, type LayoutElement, type TextElement } from '@/lib/print-designer/types';

const MIN_SHRINK_PT = 5;

// Whether an element prints with these values: showIf names a field that
// must have a value; a text box whose placeholders are all empty is left out.
export function isElementVisible(el: LayoutElement, values: Record<string, string>) {
  if (el.showIf && !values[el.showIf]) return false;
  if (el.type === 'text' && el.hideIfEmpty) {
    const tokens = tokensIn(el.text);
    if (tokens.length > 0 && tokens.every((k) => !values[k])) return false;
  }
  return true;
}

function TextBox({ el, values, baseFamily }: { el: TextElement; values: Record<string, string>; baseFamily: FontFamily }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const text = fillTokens(el.text, values);

  // Shrink-to-fit: step the font down until the text fits the box. Runs on
  // the DOM directly, before paint, so print never sees the overflow.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    inner.style.fontSize = `${el.fontSize}pt`;
    box.dataset.overflow = '';
    const fits = () => inner.scrollHeight <= box.clientHeight + 1 && inner.scrollWidth <= box.clientWidth + 1;
    if (el.fit === 'shrink') {
      let size = el.fontSize;
      while (!fits() && size > MIN_SHRINK_PT) {
        size = Math.max(MIN_SHRINK_PT, size - 0.5);
        inner.style.fontSize = `${size}pt`;
      }
    }
    // Read by the designer to warn about text that doesn't fit.
    if (!fits()) box.dataset.overflow = '1';
  }, [text, el.fontSize, el.fit, el.w, el.h, el.bold, el.italic, el.uppercase, el.fontFamily, baseFamily]);

  const justify = el.vAlign === 'middle' ? 'center' : el.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  return (
    <div
      ref={boxRef}
      data-el={el.id}
      style={{
        ...box(el),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        overflow: 'hidden',
      }}
    >
      <div
        ref={textRef}
        style={{
          fontFamily: FONT_STACK[el.fontFamily || baseFamily],
          fontSize: `${el.fontSize}pt`,
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? 'italic' : 'normal',
          textDecoration: el.underline ? 'underline' : 'none',
          textTransform: el.uppercase ? 'uppercase' : 'none',
          textAlign: el.align,
          color: el.color || '#000000',
          lineHeight: 1.2,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function box(el: LayoutElement): CSSProperties {
  return {
    position: 'absolute',
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.w}mm`,
    height: `${el.h}mm`,
    boxSizing: 'border-box',
  };
}

export function ElementView({
  el,
  values,
  logoUrl,
  baseFamily,
  design = false,
}: {
  el: LayoutElement;
  values: Record<string, string>;
  logoUrl: string | null;
  baseFamily: FontFamily;
  // In the designer: empty images show a placeholder instead of nothing.
  design?: boolean;
}) {
  if (el.type === 'text') return <TextBox el={el} values={values} baseFamily={baseFamily} />;

  if (el.type === 'image') {
    const src = resolveUploadUrl(el.src === 'logo' ? logoUrl : el.src);
    if (!src) {
      return design ? (
        <div
          data-el={el.id}
          style={{ ...box(el), border: '1px dashed #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7pt', color: '#64748b' }}
        >
          {el.src === 'logo' ? 'Logo' : 'Image'}
        </div>
      ) : null;
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img data-el={el.id} src={src} alt="" draggable={false} style={{ ...box(el), objectFit: el.fit, display: 'block' }} />
    );
  }

  if (el.type === 'line') {
    const horizontal = el.w >= el.h;
    const border = `${el.thickness}mm ${el.lineStyle} ${el.color || '#000000'}`;
    return (
      <div
        data-el={el.id}
        style={{
          ...box(el),
          ...(horizontal ? { height: `${el.thickness}mm`, borderTop: border } : { width: `${el.thickness}mm`, borderLeft: border }),
        }}
      />
    );
  }

  return (
    <div
      data-el={el.id}
      style={{
        ...box(el),
        border: el.borderWidth > 0 ? `${el.borderWidth}mm ${el.lineStyle} ${el.borderColor || '#000000'}` : 'none',
        background: el.fill || 'transparent',
        borderRadius: `${el.radius}mm`,
      }}
    />
  );
}
