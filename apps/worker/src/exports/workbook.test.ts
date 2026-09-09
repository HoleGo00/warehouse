import { describe, expect, it } from 'vitest';
import { workbookText } from './workbook.js';
describe('workbook text safety', () => {
  it('preserves formula-looking text as strings and numbers as numbers', () => {
    expect(workbookText('=HYPERLINK("https://invalid","x")')).toBe(
      '=HYPERLINK("https://invalid","x")',
    );
    expect(workbookText(3)).toBe(3);
    expect(workbookText(null)).toBe('');
  });
  it('rejects illegal controls and excessive length without truncating', () => {
    expect(() => workbookText(String.fromCharCode(0))).toThrow();
    expect(() => workbookText('x'.repeat(32_768))).toThrow();
  });
});
