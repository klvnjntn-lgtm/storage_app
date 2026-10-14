'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

type Option = { id: string; name: string };

/**
 * Searchable combobox for category/brand: filters existing options as you
 * type, lets you pick one with the mouse or keyboard, and offers to use
 * whatever you typed as a brand-new value if there's no exact match.
 * Shared by the Stock page and admin Products.
 */
export default function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  className,
  noMatchesLabel,
  createOptionLabel,
  tone = 'blue',
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder: string;
  className?: string;
  noMatchesLabel: string;
  createOptionLabel: (value: string) => string;
  // Border colour of the dropdown, to match the page around it.
  tone?: 'blue' | 'gray';
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [value, options]);

  const exactMatch = options.some((o) => o.name.toLowerCase() === value.trim().toLowerCase());
  const showCreate = value.trim().length > 0 && !exactMatch;
  const listLength = filtered.length + (showCreate ? 1 : 0);


  function selectOption(name: string) {
    onChange(name);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(listLength - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (listLength === 0) return;
      e.preventDefault();
      if (highlight < filtered.length) {
        selectOption(filtered[highlight].name);
      } else if (showCreate) {
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full min-w-0" ref={containerRef}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        className={className}
      />
      {open && (filtered.length > 0 || showCreate) && (
        <div id={listId} className={`absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border-2 ${tone === 'blue' ? 'border-blue-500/20' : 'border-gray-300'} rounded-md shadow-lg text-sm`}>
          {filtered.length > 0 ? (
            filtered.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => selectOption(opt.name)}
                className={`w-full text-left px-3 py-2 ${i === highlight ? 'bg-blue-50' : ''}`}
              >
                {opt.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-gray-400">{noMatchesLabel}</div>
          )}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => selectOption(value.trim())}
              className={`w-full text-left px-3 py-2 border-t ${tone === 'blue' ? 'border-blue-500/10' : 'border-gray-200'} text-gray-600 ${
                highlight === filtered.length ? 'bg-blue-50' : ''
              }`}
            >
              {createOptionLabel(value.trim())}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

