import { escapeLike } from './escape-like';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('A_1')).toBe('A\\_1');
    expect(escapeLike('C:\\path')).toBe('C:\\\\path');
    expect(escapeLike('plain text')).toBe('plain text');
  });
});
