import { coordsFromMapsUrl, resolveMapsLink } from './maps-link';

describe('coordsFromMapsUrl', () => {
  it("prefers the place's own pin over the map centre", () => {
    expect(
      coordsFromMapsUrl(
        'https://www.google.com/maps/place/Harmoni+Jagad+Jaya/@1.1301,104.0529,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d1.1305123!4d104.0531456',
      ),
    ).toEqual({ latitude: 1.1305123, longitude: 104.0531456, exact: true });
  });

  it('reads a coordinate query, as WhatsApp and "share location" send', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/maps?q=1.1301%2C104.0529&z=17&hl=en')).toEqual({
      latitude: 1.1301,
      longitude: 104.0529,
      exact: true,
    });
    expect(coordsFromMapsUrl('https://www.google.com/maps/search/?api=1&query=-6.2,106.816666')).toMatchObject({
      latitude: -6.2,
      longitude: 106.816666,
    });
    expect(coordsFromMapsUrl('https://www.google.com/maps/dir/?api=1&destination=1.1,104.05')).toMatchObject({
      latitude: 1.1,
    });
  });

  it('reads a pair in the path', () => {
    expect(coordsFromMapsUrl('https://www.google.com/maps/search/1.130100,+104.052900?entry=tts')).toEqual({
      latitude: 1.1301,
      longitude: 104.0529,
      exact: true,
    });
  });

  it('falls back to the map centre, marked not exact', () => {
    expect(coordsFromMapsUrl('https://www.google.com/maps/@1.1301,104.0529,15z')).toEqual({
      latitude: 1.1301,
      longitude: 104.0529,
      exact: false,
    });
  });

  it('finds nothing in a link that only names a place', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/?q=Kepri+Mall&ftid=0x31d98:0x2b')).toBeNull();
    expect(coordsFromMapsUrl('not a link')).toBeNull();
  });
});

describe('resolveMapsLink', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses anything that is not a Google Maps link, without fetching it', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(resolveMapsLink('http://169.254.169.254/latest/meta-data')).rejects.toThrow('Only Google Maps links');
    await expect(resolveMapsLink('https://evil.example/maps?q=1,2')).rejects.toThrow('Only Google Maps links');
    await expect(resolveMapsLink('file:///etc/passwd')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a short link to Google only', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps?q=1.13,104.05' } }),
    );
    await expect(resolveMapsLink('https://maps.app.goo.gl/AbC123')).resolves.toMatchObject({ latitude: 1.13 });

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    );
    await expect(resolveMapsLink('https://maps.app.goo.gl/AbC123')).rejects.toThrow('Only Google Maps links');
  });
});
