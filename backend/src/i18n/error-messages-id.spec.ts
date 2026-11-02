import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { ERROR_MESSAGES_ID } from './error-messages-id';
import { toIndonesian, translateBody, wantsIndonesian } from './translate-message';

// Every exception message written in src/, with `{}` for the parts filled
// in at runtime — the same shape ERROR_MESSAGES_ID is keyed by.
function messagesInSource(): string[] {
  const found = new Set<string>();
  const pattern = (e: ts.Expression | undefined): string[] => {
    if (!e) return [];
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (ts.isTemplateExpression(e)) return [e.head.text + e.templateSpans.map((s) => '{}' + s.literal.text).join('')];
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const [a] = pattern(e.left);
      const [b] = pattern(e.right);
      return [(a ?? '{}') + (b ?? '{}')];
    }
    if (ts.isParenthesizedExpression(e)) return pattern(e.expression);
    if (ts.isConditionalExpression(e)) return [...pattern(e.whenTrue), ...pattern(e.whenFalse)];
    return [];
  };
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (file.endsWith('.ts') && !file.endsWith('.spec.ts')) {
        const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (n: ts.Node) => {
          if (ts.isNewExpression(n) && /Exception$/.test(n.expression.getText(sf)) && n.arguments?.length) {
            const arg = n.arguments[0];
            const texts = ts.isObjectLiteralExpression(arg)
              ? arg.properties.flatMap((p) =>
                  ts.isPropertyAssignment(p) && p.name.getText(sf) === 'message' ? pattern(p.initializer) : [],
                )
              : pattern(arg);
            for (const t of texts) if (/[a-zA-Z]{2}/.test(t)) found.add(t);
          }
          ts.forEachChild(n, visit);
        };
        visit(sf);
      }
    }
  };
  walk(path.join(__dirname, '..'));
  return [...found];
}

describe('Indonesian API messages', () => {
  it('has a translation for every exception message in src/', () => {
    const known = new Set(ERROR_MESSAGES_ID.map(([en]) => en));
    const missing = messagesInSource().filter((m) => !known.has(m));
    expect(missing).toEqual([]);
  });

  it('keeps the runtime values of every translation', () => {
    for (const [en, id] of ERROR_MESSAGES_ID) {
      const holes = en.split('{}').length - 1;
      const sequential = id.split('{}').length - 1;
      const indexed = [...id.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      if (sequential) expect([en, sequential]).toEqual([en, holes]);
      for (const i of indexed) expect(i).toBeLessThan(holes);
    }
  });

  it('translates plain and filled-in messages', () => {
    expect(toIndonesian('Invalid credentials')).toBe('Email atau kata sandi salah');
    expect(toIndonesian('Account "1-1100" is type ASSET, not EXPENSE — an expense category must post to an expense account')).toBe(
      'Akun "1-1100" bertipe ASSET, bukan BEBAN — kategori biaya harus diposting ke akun beban',
    );
    expect(toIndonesian('Too many failed sign-in attempts. Try again in 15 minutes.')).toBe(
      'Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam 15 menit.',
    );
  });

  it('prefers the most specific pattern', () => {
    expect(toIndonesian('Product abc not found')).toBe('Produk abc tidak ditemukan');
    expect(toIndonesian('Widget not found')).toBe('Widget tidak ditemukan');
  });

  it('translates a message built from another one', () => {
    expect(toIndonesian('Discount of 30% is over the approval limit of 20%. An admin needs to approve it first.')).toBe(
      'Diskon 30% melebihi batas persetujuan 20%. Admin perlu menyetujuinya terlebih dahulu.',
    );
  });

  it('translates DTO validation lists and leaves unknown text alone', () => {
    expect(translateBody({ statusCode: 400, message: ['name should not be empty', 'each value in items must be an object'] })).toEqual({
      statusCode: 400,
      message: ['name tidak boleh kosong', 'Setiap nilai di items harus berupa objek'],
    });
    expect(toIndonesian('Something brand new')).toBe('Something brand new');
  });

  it('reads the language cookie', () => {
    expect(wantsIndonesian({ headers: { cookie: 'a=1; waresys_lang=id' } } as never)).toBe(true);
    expect(wantsIndonesian({ headers: { cookie: 'waresys_lang=en' } } as never)).toBe(false);
    expect(wantsIndonesian({ headers: {} } as never)).toBe(false);
  });
});
