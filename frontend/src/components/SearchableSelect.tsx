import React, { useState, useRef, useEffect } from 'react';

interface Option {
  value: string;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchableSelect({ options, value, onChange, placeholder = 'Search...', disabled }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label || '';

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.group || '').toLowerCase().includes(search.toLowerCase())
  );

  // Group filtered items
  const grouped: Record<string, Option[]> = {};
  filtered.forEach(o => {
    const g = o.group || 'Other';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(o);
  });

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Display/Trigger */}
      <div
        onClick={() => { if (!disabled) { setIsOpen(!isOpen); setTimeout(() => inputRef.current?.focus(), 50); } }}
        style={{
          border: '1px solid #ddd', borderRadius: 6, padding: '10px 12px',
          cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#f5f5f5' : '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          minHeight: 42,
        }}
      >
        <span style={{ color: value ? '#333' : '#999' }}>
          {selectedLabel || placeholder}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {value && (
            <span onClick={handleClear} style={{ cursor: 'pointer', color: '#999', fontSize: '1.1rem', lineHeight: 1 }}>×</span>
          )}
          <span style={{ color: '#999', fontSize: '0.8rem' }}>▼</span>
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #ddd', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginTop: 4,
          maxHeight: 320, display: 'flex', flexDirection: 'column',
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #eee' }}>
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type to search designations..."
              style={{
                width: '100%', border: '1px solid #e0e0e0', borderRadius: 4,
                padding: '8px 10px', fontSize: '0.9rem', outline: 'none',
              }}
              onFocus={e => e.target.select()}
            />
          </div>

          {/* Options list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {Object.keys(grouped).length === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', color: '#999' }}>
                No designations found
              </div>
            )}
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <div style={{
                  padding: '8px 12px', background: '#f8f9fa', color: '#1a237e',
                  fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.5px', position: 'sticky', top: 0,
                }}>
                  {group}
                </div>
                {items.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    style={{
                      padding: '9px 16px', cursor: 'pointer',
                      background: opt.value === value ? '#e8eaf6' : 'transparent',
                      fontSize: '0.9rem',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = opt.value === value ? '#e8eaf6' : '#f5f5f5')}
                    onMouseLeave={e => (e.currentTarget.style.background = opt.value === value ? '#e8eaf6' : 'transparent')}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
