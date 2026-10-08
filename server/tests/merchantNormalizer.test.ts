import { describe, it, expect } from 'vitest';
import {
  matchesPhrase,
  normalizeChannelToken,
  normalizeDescription,
  normalizeMerchant,
} from '../src/services/categorization/merchantNormalizer.js';

describe('merchant normalizer', () => {
  it('collapses provider noise variants to one stable key', () => {
    expect(normalizeMerchant('SWIGGY*ORDER123')).toBe('swiggy');
    expect(normalizeMerchant('Swiggy Order #123')).toBe('swiggy');
    expect(normalizeMerchant('SWIGGY IN')).toBe('swiggy');
    expect(normalizeMerchant('swiggy')).toBe('swiggy');
    expect(normalizeMerchant('  Swiggy  ')).toBe('swiggy');
    expect(normalizeMerchant('UPI payment - Swiggy')).toBe('swiggy');
    expect(normalizeMerchant('RELIANCE FRESH 4521')).toBe('reliance fresh');
    expect(normalizeMerchant('amazon ref99887766')).toBe('amazon');
    expect(normalizeMerchant('Swiggy Order 9988776655')).toBe('swiggy');
    expect(normalizeMerchant('Amazon Order #55')).toBe('amazon');
  });

  it('keeps meaningful merchant words', () => {
    expect(normalizeMerchant('Acme Corp')).toBe('acme corp');
    expect(normalizeMerchant('HP Petrol Pump')).toBe('hp petrol pump');
    expect(normalizeMerchant('7-Eleven')).toBe('7 eleven');
    expect(normalizeMerchant('Cafe Coffee Day')).toBe('cafe coffee day');
    expect(normalizeMerchant('HDFC ATM')).toBe('hdfc atm');
  });

  it('returns null for inputs with no merchantable text', () => {
    expect(normalizeMerchant(null)).toBeNull();
    expect(normalizeMerchant(undefined)).toBeNull();
    expect(normalizeMerchant('')).toBeNull();
    expect(normalizeMerchant('   ')).toBeNull();
    expect(normalizeMerchant('***')).toBeNull();
    expect(normalizeMerchant('12345')).toBeNull();
    expect(normalizeMerchant('___')).toBeNull();
  });

  it('is deterministic for repeated calls', () => {
    const inputs = [
      'SWIGGY*ORDER123',
      'Acme Corp',
      'UPI payment - Swiggy',
      'RELIANCE FRESH 4521',
      '***',
    ];
    for (const input of inputs) {
      expect(normalizeMerchant(input)).toBe(normalizeMerchant(input));
    }
  });

  it('does not strip short trailing tokens such as 7-Eleven', () => {
    expect(normalizeMerchant('Swiggy 45')).toBe('swiggy 45');
  });

  it('normalizes description text for phrase matching', () => {
    expect(normalizeDescription('Electricity Bill Payment!')).toBe('electricity bill payment');
    expect(normalizeDescription('Monthly   Salary')).toBe('monthly salary');
    expect(normalizeDescription(null)).toBeNull();
    expect(normalizeDescription('   ')).toBeNull();
  });

  it('matches phrases only on token boundaries', () => {
    expect(matchesPhrase('powerade bottles', 'power')).toBe(false);
    expect(matchesPhrase('mseb power bill', 'power')).toBe(true);
    expect(matchesPhrase('swiggy bazaar', 'swiggy')).toBe(true);
    expect(matchesPhrase('swiggy', 'swiggy')).toBe(true);
    expect(matchesPhrase('super swiggyexpress', 'swiggy')).toBe(false);
    expect(matchesPhrase(null, 'swiggy')).toBe(false);
    expect(matchesPhrase('swiggy', '')).toBe(false);
  });

  it('trims channel tokens without rewriting them', () => {
    expect(normalizeChannelToken(' PHONEPE ')).toBe('PHONEPE');
    expect(normalizeChannelToken('')).toBeNull();
    expect(normalizeChannelToken(null)).toBeNull();
  });
});
