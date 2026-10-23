import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isNewer } = require('../../../electron/version.cjs') as { isNewer: (a: string, b: string) => boolean };

describe('desktop update version check', () => {
  it('compares versions number by number', () => {
    expect(isNewer('1.1.0', '1.0.0')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '1.0.1')).toBe(false);
    expect(isNewer('2.0', '1.9.9')).toBe(true);
  });
});
