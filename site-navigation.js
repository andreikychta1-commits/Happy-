(() => {
  'use strict';
  const scene = document.querySelector('main.scene');
  const musicButton = document.getElementById('open-player');
  if (!scene || !musicButton) return;

  // Keep this document and its audio alive while the other scenes change.
  const home = new URL('cosmos.html', location.href);
  const pages = new Map([
    ['index', { file: 'index.html', title: 'Открытка для Наташи' }],
    ['moon', { file: 'moon.html', title: 'Луна' }],
    ['lantern', { file: 'lantern.html', title: 'Сад желаний' }],
    ['letter', { file: 'letter.html', title: 'Письмо для тебя' }]
  ]);
  const homeTitle = document.title;
  let frame = null;
  let currentScene = '';
  let homeScroll = 0;
  let returnFocus = null;
  let focusAfterLoad = false;

  function routeURL(key, hash = '') {
    const url = new URL(home);
    if (key) url.searchParams.set('scene', key);
    url.hash = hash;
    return url;
  }
  function selectedScene() {
    const key = new URL(location.href).searchParams.get('scene') || '';
    return pages.has(key) ? key : '';
  }
  function showScene(key, hash = '', focus = true) {
    const page = pages.get(key);
    currentScene = key;
    focusAfterLoad = focus;
    if (!page) {
      frame?.remove();
      frame = null;
      scene.hidden = false;
      scene.inert = false;
      document.body.classList.remove('is-site-page');
      document.title = homeTitle;
      window.scrollTo(0, homeScroll);
      if (focus) (returnFocus?.isConnected ? returnFocus : musicButton).focus({ preventScroll: true });
      return;
    }

    if (!scene.hidden) {
      homeScroll = window.scrollY;
      returnFocus = document.activeElement;
      scene.hidden = true;
      scene.inert = true;
      document.body.classList.add('is-site-page');
    }
    document.title = `${page.title} — Для тебя`;
    const destination = new URL(page.file, home);
    destination.hash = hash;
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'site-frame';
      frame.title = page.title;
      frame.src = destination.href;
      frame.addEventListener('load', event => {
        const loadedFrame = event.currentTarget;
        if (loadedFrame !== frame || !loadedFrame.contentDocument || !currentScene) return;
        const childDocument = loadedFrame.contentDocument;
        if (childDocument.URL === 'about:blank') return;
        childDocument.addEventListener('click', routeLink);
        if (focusAfterLoad && !document.getElementById('music-player').classList.contains('is-open')) loadedFrame.contentWindow.focus();
      });
      document.body.appendChild(frame);
    } else {
      frame.title = page.title;
      // Replacing the child entry leaves Back/Forward under the outer page's control.
      frame.contentWindow.location.replace(destination.href);
    }
  }
  function navigate(key, hash = '') {
    if (key === currentScene && !hash) return;
    history.pushState({ birthdayScene: key }, '', routeURL(key, hash));
    showScene(key, hash);
  }
  function routeLink(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const source = new URL(anchor.ownerDocument.URL);
    const destination = new URL(anchor.href, source);
    if (destination.origin !== home.origin) return;
    // Local anchors still scroll and focus within their own scene.
    if (destination.pathname === source.pathname && destination.search === source.search && destination.hash) return;
    let key = destination.pathname === home.pathname ? '' : null;
    for (const [name, page] of pages) {
      if (destination.pathname === new URL(page.file, home).pathname) key = name;
    }
    if (key === null) return;
    event.preventDefault();
    navigate(key, destination.hash);
  }
  document.addEventListener('click', routeLink);
  window.addEventListener('popstate', () => showScene(selectedScene(), location.hash));
  history.replaceState({ birthdayScene: selectedScene() }, '', routeURL(selectedScene(), location.hash));
  if (selectedScene()) showScene(selectedScene(), location.hash, false);
})();
