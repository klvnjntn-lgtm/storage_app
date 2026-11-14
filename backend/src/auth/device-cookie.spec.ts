import { PHONE_COOKIE, requestPhoneId, resolvePhoneId } from './device-cookie';

const req = (headers: Record<string, string>) => ({ headers }) as never;
const COOKIE_ID = '11111111-2222-3333-4444-555555555555';
const HEADER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('driver phone id', () => {
  it('prefers the server cookie over the header, so a cleared localStorage keeps the approved id', () => {
    const r = req({ cookie: `other=x; ${PHONE_COOKIE}=${COOKIE_ID}`, 'x-device-id': HEADER_ID });
    expect(resolvePhoneId(r)).toBe(COOKIE_ID);
    expect(requestPhoneId(r)).toBe(COOKIE_ID);
  });

  it('seeds from the header, then the login body, when there is no cookie', () => {
    expect(resolvePhoneId(req({ 'x-device-id': HEADER_ID }))).toBe(HEADER_ID);
    expect(resolvePhoneId(req({}), HEADER_ID)).toBe(HEADER_ID);
  });

  it('mints an id when the browser sent none or a malformed one', () => {
    const minted = resolvePhoneId(req({ 'x-device-id': '' }));
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolvePhoneId(req({ 'x-device-id': 'bad id; drop table' }))).not.toBe('bad id; drop table');
    expect(requestPhoneId(req({}))).toBeNull();
  });
});
