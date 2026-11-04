// How long to wait for the Maps app to take over on iOS before assuming it
// isn't installed and falling back to the web version.
const IOS_FALLBACK_MS = 2500;

function iosAppUrl(webUrl: string): string {
  const params = new URL(webUrl).searchParams;
  const destination = params.get('destination');
  if (destination) {
    return `comgooglemaps://?daddr=${encodeURIComponent(destination)}&directionsmode=driving`;
  }
  return `comgooglemaps://?q=${encodeURIComponent(params.get('query') ?? '')}`;
}

// Safari on iOS opens the app from a plain https Maps link, so it's left alone.
// Other iOS browsers identify themselves in the user agent.
const IOS_OTHER_BROWSER = /CriOS|FxiOS|OPiOS|OPT\/|EdgiOS|YaBrowser|DuckDuckGo|Brave/i;

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS Safari reports itself as a Mac, so touch support tells them apart.
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

// Whether a plain https Maps link would land on Google's web page instead of
// the app: Android, and iOS browsers other than Safari.
export function needsMapsAppLink(): boolean {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return true;
  return isIos() && IOS_OTHER_BROWSER.test(ua);
}

// A plain https Maps link is left to the browser, which can load Google's web
// page first and only then offer the app. Where that happens this asks for the
// Google Maps app by name instead, leaving the current page where it was.
//
// Takes a www.google.com/maps URL using `destination` (directions) or `query`
// (a pin). Returns false when the caller should use the web link as normal.
//
// Must run inside the tap: browsers refuse to launch an app from a timer or
// callback.
export function openGoogleMapsApp(webUrl: string): boolean {
  if (!needsMapsAppLink()) return false;
  if (/Android/i.test(navigator.userAgent)) {
    // The fallback is for a phone without Maps.
    const fallback = encodeURIComponent(webUrl);
    window.location.href = `intent://${webUrl.slice('https://'.length)}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${fallback};end`;
    return true;
  }

  // iOS has no built-in fallback for an app link, so if this page is still in
  // front after a moment the app didn't open.
  const timer = setTimeout(() => {
    cleanup();
    if (document.visibilityState === 'visible') window.location.href = webUrl;
  }, IOS_FALLBACK_MS);
  const onHidden = () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer);
      cleanup();
    }
  };
  const cleanup = () => document.removeEventListener('visibilitychange', onHidden);
  document.addEventListener('visibilitychange', onHidden);
  window.location.href = iosAppUrl(webUrl);
  return true;
}
