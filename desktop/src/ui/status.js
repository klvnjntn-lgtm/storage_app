const $ = (id) => document.getElementById(id);
const ui = window.waresysUi;
const VIEWS = ['loading', 'role', 'connect', 'license', 'error'];

function show(view) {
  for (const id of VIEWS) $(id).hidden = id !== view;
}

function setError(el, message) {
  el.hidden = !message;
  el.textContent = message || '';
}

function renderConnect(state) {
  setError($('connect-error'), state.message);
  $('searching').hidden = !state.searching;
  const found = state.found || [];
  $('none-found').hidden = state.searching || found.length > 0;
  $('pcs').replaceChildren(
    ...found.map((pc) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pc';
      const name = document.createElement('strong');
      name.textContent = pc.name;
      const addr = document.createElement('span');
      addr.textContent = pc.addresses[0].replace(/^http:\/\//, '');
      b.append(name, addr);
      b.addEventListener('click', () => ui.connect({ name: pc.name, addresses: pc.addresses }));
      return b;
    }),
  );
  $('search-again').disabled = !!state.searching;
}

ui.onState((state) => {
  if (state.view === 'loading') {
    $('loading-text').textContent = state.message || 'Starting…';
  } else if (state.view === 'connect') {
    renderConnect(state);
  } else if (state.view === 'license') {
    setError($('license-error'), state.message);
    if (state.licenseKey) $('license-key').value = state.licenseKey;
    $('license-key').focus();
  } else if (state.view === 'error') {
    $('error-text').textContent = state.message;
    const actions = state.actions || ['retry'];
    $('choose-main').hidden = !actions.includes('connect');
    $('restore').hidden = !actions.includes('restore');
    $('logs').hidden = !actions.includes('logs');
  }
  show(state.view);
});

$('role-main').addEventListener('click', () => ui.chooseRole('main'));
$('role-client').addEventListener('click', () => ui.chooseRole('client'));
$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const address = $('address').value.trim();
  if (address) ui.connect({ address });
});
$('search-again').addEventListener('click', () => ui.search());
$('connect-back').addEventListener('click', () => ui.back());
$('license').addEventListener('submit', (e) => {
  e.preventDefault();
  const key = $('license-key').value.trim();
  if (key) ui.submitLicense(key);
});
$('retry').addEventListener('click', () => ui.retry());
$('choose-main').addEventListener('click', () => ui.chooseMain());
$('restore').addEventListener('click', () => ui.restore());
$('logs').addEventListener('click', () => ui.openLogs());

ui.ready();
