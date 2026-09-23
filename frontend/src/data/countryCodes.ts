export interface CountryCode {
  code: string;
  country: string;
  flag: string;
}

/**
 * Split a stored mobile string into a dial code and a local number.
 *
 * Matches against the known code list, longest first, so "+917493065954" (stored
 * without a separating space) yields "+91" + "7493065954" rather than dumping the
 * whole number into the dial code. A greedy /^(\+\d+)/ regex gets this wrong, and
 * the mis-parsed value then gets a second code prepended on save.
 */
export function splitMobile(stored: string | null | undefined): { code: string; number: string } {
  const raw = String(stored ?? '').trim();
  if (!raw) return { code: '+91', number: '' };

  if (raw.startsWith('+')) {
    const compact = raw.replace(/[\s-]/g, '');
    const byLength = [...new Set(COUNTRY_CODES.map(c => c.code))].sort((a, b) => b.length - a.length);
    for (const code of byLength) {
      if (compact.startsWith(code)) {
        return { code, number: compact.slice(code.length) };
      }
    }
    // Unrecognised dial code: keep the digits, fall back to the default code.
    return { code: '+91', number: compact.replace(/^\+/, '') };
  }

  return { code: '+91', number: raw.replace(/[^0-9]/g, '') };
}

/** Recombine into the canonical stored form: "+91 9876543210". */
export function joinMobile(code: string, number: string): string {
  const digits = String(number ?? '').replace(/[^0-9]/g, '');
  return digits ? `${code} ${digits}` : '';
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+1', country: 'USA', flag: '🇺🇸' },
  { code: '+1', country: 'Canada', flag: '🇨🇦' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
  { code: '+82', country: 'South Korea', flag: '🇰🇷' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
  { code: '+234', country: 'Nigeria', flag: '🇳🇬' },
  { code: '+254', country: 'Kenya', flag: '🇰🇪' },
  { code: '+62', country: 'Indonesia', flag: '🇮🇩' },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾' },
  { code: '+63', country: 'Philippines', flag: '🇵🇭' },
  { code: '+66', country: 'Thailand', flag: '🇹🇭' },
  { code: '+84', country: 'Vietnam', flag: '🇻🇳' },
  { code: '+880', country: 'Bangladesh', flag: '🇧🇩' },
  { code: '+92', country: 'Pakistan', flag: '🇵🇰' },
  { code: '+94', country: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+977', country: 'Nepal', flag: '🇳🇵' },
];
