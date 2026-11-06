// When a phone loses signal for a moment, the page's code files can fail to
// load. Either the page looks fine but nothing responds (first load, so React
// never starts) or it lands on the error screen (moving between pages). Both
// clear with a reload once the connection is back, so that's what happens.
//
// The script runs before any of the app's code, as it has to work when that
// code is what failed. It only reloads a page that never started, so a page
// someone is typing into is safe. At most one reload every 30 seconds, with a
// bar and reload button in between, and none while the phone reports it's
// offline or the page is out of view, so it can't burn through someone's data.
export const pageRecoveryScript = `(function () {
  var GUARD = 'waresys.recoveryAt', QUEUE = 'waresys.clientErrors', RETRY_MS = 30000;
  var started = false;
  function queue(kind, message) {
    try {
      var list = JSON.parse(localStorage.getItem(QUEUE) || '[]');
      if (list.length < 5) list.push({ kind: kind, message: String(message || '').slice(0, 500), page: location.pathname });
      localStorage.setItem(QUEUE, JSON.stringify(list));
    } catch (e) {}
  }
  function mayReload() {
    try {
      var last = Number(sessionStorage.getItem(GUARD) || 0);
      if (Date.now() - last < RETRY_MS) return false;
      sessionStorage.setItem(GUARD, String(Date.now()));
      return true;
    } catch (e) { return false; }
  }
  function bar() {
    if (document.getElementById('waresys-recovery-bar') || !document.body) return;
    var el = document.createElement('div');
    el.id = 'waresys-recovery-bar';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 12px;background:#b91c1c;color:#fff;font:600 14px system-ui,sans-serif';
    var text = document.createElement('span');
    text.textContent = 'Koneksi bermasalah, halaman belum termuat. · Connection problem, the page did not finish loading.';
    var button = document.createElement('button');
    button.textContent = 'Muat ulang · Reload';
    button.style.cssText = 'flex:none;padding:8px 12px;border:0;border-radius:6px;background:#fff;color:#b91c1c;font:600 14px system-ui,sans-serif';
    button.onclick = function () { location.reload(); };
    el.appendChild(text);
    el.appendChild(button);
    document.body.appendChild(el);
  }
  // Waits for the connection, then reloads. showBar: no error screen is up to explain it.
  function recover(kind, message, showBar) {
    queue(kind, message);
    function go() {
      if (started && showBar) return;
      if (document.hidden) { addEventListener('visibilitychange', go, { once: true }); return; }
      if (mayReload()) { location.reload(); return; }
      if (showBar) bar();
      setTimeout(go, RETRY_MS);
    }
    if (navigator.onLine === false) {
      if (showBar) bar();
      addEventListener('online', go, { once: true });
    } else go();
  }
  window.__waresysRecover = recover;
  window.__waresysPageReady = function () {
    started = true;
    var el = document.getElementById('waresys-recovery-bar');
    if (el) el.remove();
  };
  addEventListener('error', function (e) {
    var t = e.target;
    if (!started && t && t.tagName === 'SCRIPT' && /\\/_next\\/static\\//.test(t.src)) recover('script-failed', t.src, true);
  }, true);
  // A file that neither loads nor fails, on a very weak signal.
  setTimeout(function check() {
    if (started) return;
    if (document.hidden) { addEventListener('visibilitychange', check, { once: true }); return; }
    recover('page-not-started', '', true);
  }, 30000);
})();`;

declare global {
  interface Window {
    __waresysRecover?: (kind: string, message: string, showBar: boolean) => void;
    __waresysPageReady?: () => void;
  }
}

// The errors a reload fixes: code files or page data cut off in transit.
// #412 is React's minified "Connection closed".
export function isConnectionError(error: Error) {
  return /chunk|dynamically imported module|importing a module script|connection closed|react error #412/i.test(
    `${error.name} ${error.message}`,
  );
}

// To the server's log. Kept on the phone until it goes through, since these
// tend to happen with no signal.
const QUEUE_KEY = 'waresys.clientErrors';
type ClientError = { kind: string; message?: string; page?: string; digest?: string };

export function reportClientError(report: ClientError) {
  try {
    const list: ClientError[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (list.length < 5) list.push({ ...report, message: report.message?.slice(0, 500), page: window.location.pathname });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // no storage: nothing to keep it in
  }
  void flushClientErrors();
}

export async function flushClientErrors() {
  try {
    const list: ClientError[] = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (list.length === 0) return;
    localStorage.removeItem(QUEUE_KEY);
    const left: ClientError[] = [];
    for (const report of list) {
      const res = await fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'waresys' },
        body: JSON.stringify(report),
      }).catch(() => null);
      if (!res) left.push(report);
    }
    if (left.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(left));
  } catch {
    // reporting must never cause a problem of its own
  }
}
