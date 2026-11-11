(() => {
  'use strict';
  const panel = document.getElementById('music-player');
  const openButton = document.getElementById('open-player');
  const closeButton = document.getElementById('close-player');
  const playButton = document.getElementById('start-track');
  const stopButton = document.getElementById('stop-track');
  const quickStopButton = document.getElementById('quick-stop-track');
  const initialHost = document.getElementById('youtube-track');
  const status = document.getElementById('track-status');
  const clock = document.getElementById('track-clock');
  const notes = document.getElementById('music-notes');
  const effectsButton = document.getElementById('toggle-music-effects');
  if (!panel || !openButton || !closeButton || !playButton || !stopButton || !initialHost || !status || !clock || !notes || !effectsButton) return;
  const videoId = initialHost.dataset.videoId;
  if (!videoId) return;
  const videoContainer = initialHost.parentElement;
  const songName = document.getElementById('song-name')?.textContent.trim() || 'MY JEALOUSY';
  const songDetail = panel.querySelector('.song-detail')?.textContent.trim() || 'vivi baby / ovg!';
  const trackLabel = `${songName} — ${songDetail}`;
  const isWebPage = location.protocol === 'http:' || location.protocol === 'https:';
  const localFileMessage = 'Нажми ▶ — песня откроется на YouTube. Чтобы она играла прямо здесь, открой сайт через «Запустить сайт».';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let phase = 'idle';
  let wantsPlayback = false;
  let playbackIntent = 'none';
  let request = 0;
  let generation = 0;
  let player = null;
  let playerReady = false;
  let preparation = null;
  let apiPromise = null;
  let clockTimer = 0;
  let currentTime = 0;
  let mutedByApp = true;
  let noteTimer = 0;
  let effectsEnabled = true;
  let atmosphereActive = false;
  const noteCleanup = new Map();
  let musicSync = null;
  try { musicSync = new window.BroadcastChannel('codex-birthday-music'); } catch { /* Shared channels may be unavailable. */ }
  musicSync?.addEventListener('message', event => {
    if (event.data === 'stop') stopMusic();
  });
  window.addEventListener('storage', event => {
    if (event.key === 'codex-birthday-music-stop' && event.newValue) stopMusic();
  });

  const isOpen = () => panel.classList.contains('is-open');
  const message = text => { if (status.textContent !== text) status.textContent = text; };
  const timeLabel = seconds => {
    const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  };
  function clearNotes() {
    window.clearTimeout(noteTimer);
    noteTimer = 0;
    for (const timeout of noteCleanup.values()) window.clearTimeout(timeout);
    noteCleanup.clear();
    notes.replaceChildren();
  }
  function releaseNote() {
    if (!atmosphereActive || reducedMotion.matches || noteCleanup.size >= 10) return;
    const note = document.createElement('span');
    note.className = 'paper-note';
    note.textContent = ['♪', '♫', '✦'][Math.floor(Math.random() * 3)];
    note.style.setProperty('--x', `${45 + Math.random() * 48}%`);
    note.style.setProperty('--drift', `${(Math.random() - .5) * 140}px`);
    note.style.setProperty('--turn', `${(Math.random() - .5) * 45}deg`);
    note.style.setProperty('--delay', '0s');
    const duration = 8 + Math.random() * 4;
    note.style.setProperty('--duration', `${duration}s`);
    const remove = () => {
      window.clearTimeout(noteCleanup.get(note));
      noteCleanup.delete(note);
      note.remove();
    };
    note.addEventListener('animationend', event => { if (event.target === note) remove(); });
    notes.appendChild(note);
    noteCleanup.set(note, window.setTimeout(remove, duration * 1000 + 500));
  }
  function noteLoop() {
    if (!atmosphereActive || reducedMotion.matches) return;
    releaseNote();
    noteTimer = window.setTimeout(noteLoop, 1500);
  }
  function refreshAtmosphere() {
    const active = phase === 'playing' && effectsEnabled && isOpen() && !document.hidden;
    document.body.classList.toggle('music-is-playing', active);
    if (atmosphereActive === active) return;
    atmosphereActive = active;
    clearNotes();
    if (active && !reducedMotion.matches) noteLoop();
  }
  function refreshClock() {
    if (playerReady && player) {
      try { currentTime = player.getCurrentTime() || 0; } catch { /* The iframe may be disappearing. */ }
    }
    const suffix = phase === 'idle' ? 'начало' : phase === 'paused' ? 'пауза' : phase === 'loading' || phase === 'buffering' ? 'загрузка' : phase === 'error' ? 'ожидание' : 'сейчас';
    clock.textContent = `${timeLabel(currentTime)} · ${suffix}`;
  }
  function setPhase(next, text) {
    phase = next;
    panel.classList.toggle('is-playing', next === 'playing');
    openButton.classList.toggle('is-playing', next === 'playing');
    if (quickStopButton) quickStopButton.hidden = !['loading', 'playing', 'buffering', 'paused'].includes(next);
    playButton.disabled = next === 'loading';
    panel.setAttribute('aria-busy', String(next === 'loading'));
    const pausable = next === 'playing' || next === 'buffering';
    playButton.textContent = pausable ? 'Ⅱ пауза' : next === 'loading' ? 'загрузка…' : next === 'error' ? '↻ ещё раз' : '▶ играть';
    playButton.setAttribute('aria-label', pausable ? 'Приостановить музыку' : next === 'paused' ? 'Продолжить музыку' : `Включить ${trackLabel}`);
    window.clearInterval(clockTimer);
    clockTimer = next === 'playing' ? window.setInterval(refreshClock, 1000) : 0;
    if (text) message(text);
    refreshClock();
    refreshAtmosphere();
  }
  function ensureHost() {
    let host = document.getElementById('youtube-track');
    if (host && host.tagName !== 'IFRAME') return host;
    host?.remove();
    host = document.createElement('div');
    host.id = 'youtube-track';
    host.dataset.videoId = videoId;
    videoContainer.prepend(host);
    return host;
  }
  function destroyPlayer() {
    generation++;
    if (preparation) {
      window.clearTimeout(preparation.timer);
      preparation.resolve(null);
      preparation = null;
    }
    const oldPlayer = player;
    player = null;
    playerReady = false;
    mutedByApp = true;
    if (oldPlayer) {
      try { oldPlayer.mute(); } catch { /* The API may not be ready. */ }
      try { oldPlayer.destroy(); } catch { /* Removing the iframe below still stops it. */ }
    }
    ensureHost();
  }
  function failPlayer(expectedGeneration, text) {
    if (expectedGeneration !== generation) return;
    const pending = preparation;
    if (pending) window.clearTimeout(pending.timer);
    preparation = null;
    request++;
    wantsPlayback = false;
    playbackIntent = 'none';
    destroyPlayer();
    setPhase('error', text);
    pending?.reject(new Error(text));
  }
  function loadYouTubeAPI() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      let finished = false;
      const previousReady = window.onYouTubeIframeAPIReady;
      let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      const ownScript = !script;
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
      }
      const finish = error => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        script.removeEventListener('error', onError);
        if (window.onYouTubeIframeAPIReady === onReady) window.onYouTubeIframeAPIReady = previousReady;
        if (error) {
          apiPromise = null;
          if (ownScript) script.remove();
          reject(error);
        } else resolve();
      };
      const onReady = () => {
        try { if (typeof previousReady === 'function') previousReady(); } catch { /* Another player's callback must not block this one. */ }
        finish();
      };
      const onError = () => finish(new Error('Не удалось подключиться к YouTube. Проверь интернет или открой песню на YouTube.'));
      const timer = window.setTimeout(() => finish(new Error('YouTube не отвечает. Нажми «Ещё раз» или открой песню на YouTube.')), 15000);
      window.onYouTubeIframeAPIReady = onReady;
      script.addEventListener('error', onError, { once: true });
      if (ownScript) document.head.appendChild(script);
    });
    return apiPromise;
  }
  function configureIframe(target) {
    const iframe = target.getIframe();
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.title = trackLabel;
  }
  function ensurePlayer() {
    if (!isWebPage) {
      wantsPlayback = false;
      playbackIntent = 'none';
      setPhase('idle', localFileMessage);
      return Promise.resolve(null);
    }
    if (playerReady && player) return Promise.resolve(player);
    if (preparation) return preparation.promise;
    const expectedGeneration = ++generation;
    let resolveReady;
    let rejectReady;
    const promise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    preparation = {
      promise,
      resolve: resolveReady,
      reject: rejectReady,
      timer: window.setTimeout(() => failPlayer(expectedGeneration, 'YouTube долго загружается. Нажми «Ещё раз» или открой песню на YouTube.'), 15000)
    };
    loadYouTubeAPI().then(() => {
      if (expectedGeneration !== generation || !preparation) return;
      ensureHost();
      const playerVars = { autoplay: 0, controls: 1, playsinline: 1, loop: 1, playlist: videoId, rel: 0, origin: location.origin };
      player = new window.YT.Player('youtube-track', {
        videoId,
        width: '100%',
        height: '200',
        playerVars,
        events: {
          onReady(event) {
            if (expectedGeneration !== generation) {
              try { event.target.mute(); event.target.destroy(); } catch { /* A stopped player cannot be reused. */ }
              return;
            }
            player = event.target;
            playerReady = true;
            player.setVolume(55);
            player.mute();
            mutedByApp = true;
            configureIframe(player);
            const pending = preparation;
            preparation = null;
            if (pending) {
              window.clearTimeout(pending.timer);
              pending.resolve(player);
            }
            if (!wantsPlayback && phase === 'idle') message(`Нажми ▶ — сыграет ${trackLabel}.`);
          },
          onStateChange(event) {
            if (expectedGeneration !== generation || event.target !== player || !playerReady) return;
            const states = window.YT.PlayerState;
            if (event.data === states.PLAYING) {
              if (playbackIntent === 'pause') { player.mute(); player.pauseVideo(); return; }
              wantsPlayback = true;
              playbackIntent = 'none';
              if (mutedByApp) { player.unMute(); mutedByApp = false; }
              setPhase('playing', `Играет ${trackLabel}.`);
            } else if (event.data === states.PAUSED) {
              request++;
              wantsPlayback = false;
              playbackIntent = 'none';
              player.mute();
              mutedByApp = true;
              setPhase('paused', 'На паузе. Этот момент подождёт тебя.');
            } else if (event.data === states.BUFFERING) {
              if (playbackIntent === 'pause') { player.mute(); player.pauseVideo(); return; }
              wantsPlayback = true;
              setPhase('buffering', 'Песня подгружается…');
            } else if (event.data === states.ENDED) {
              wantsPlayback = false;
              playbackIntent = 'none';
              currentTime = 0;
              setPhase('idle', 'Песня начнётся снова.');
            }
          },
          onError(event) {
            const code = Number(event.data);
            const text = code === 153
              ? 'YouTube не разрешил запуск. Открой сайт через «Запустить сайт» или открой песню на YouTube.'
              : code === 101 || code === 150
                ? 'Автор ограничил встроенный плеер. Открой песню на YouTube по ссылке ниже.'
                : code === 100
                  ? 'Песня недоступна в YouTube. Открой оригинал по ссылке ниже.'
                  : 'YouTube не смог включить песню. Нажми «Ещё раз» или открой оригинал по ссылке ниже.';
            failPlayer(expectedGeneration, text);
          },
          onAutoplayBlocked() {
            if (expectedGeneration !== generation || !wantsPlayback) return;
            request++;
            wantsPlayback = false;
            playbackIntent = 'none';
            try { player?.mute(); } catch { /* The embedded controls still provide a retry. */ }
            mutedByApp = true;
            setPhase('error', 'YouTube ждёт нажатия. Нажми ▶ в видеоплеере или открой песню на YouTube.');
          }
        }
      });
      configureIframe(player);
    }).catch(error => failPlayer(expectedGeneration, error.message || 'Не удалось подключиться к YouTube. Открой песню по ссылке ниже.'));
    return promise;
  }
  function pauseMusic() {
    request++;
    wantsPlayback = false;
    playbackIntent = 'pause';
    if (playerReady && player) {
      try { player.mute(); player.pauseVideo(); } catch { /* The iframe may be disappearing. */ }
    }
    mutedByApp = true;
    if (phase === 'error' || phase === 'idle') return;
    setPhase('paused', 'На паузе. Этот момент подождёт тебя.');
  }
  function stopMusic(notifyOthers = false) {
    request++;
    wantsPlayback = false;
    playbackIntent = 'none';
    // Destroy immediately: delayed API readiness and old iframe events cannot restart this generation.
    destroyPlayer();
    currentTime = 0;
    setPhase('idle', 'Музыка остановлена. Нажми ▶, чтобы начать сначала.');
    if (notifyOthers === true) {
      try {
        if (musicSync) musicSync.postMessage('stop');
        else window.localStorage.setItem('codex-birthday-music-stop', `${Date.now()}:${Math.random()}`);
      } catch { /* Stop still works locally when cross-tab messaging is unavailable. */ }
    }
  }
  function playMusic() {
    if (phase === 'loading') return;
    if (phase === 'playing' || phase === 'buffering') { pauseMusic(); return; }
    if (!isWebPage) {
      // YouTube refuses embeds on file:// pages (error 153), so play the song in a new tab instead.
      window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, '_blank', 'noopener');
      setPhase('idle', 'Песня открыта в новой вкладке YouTube ♡ Чтобы она играла прямо здесь, запусти «Запустить сайт».');
      return;
    }
    const token = ++request;
    wantsPlayback = true;
    playbackIntent = 'play';
    setPhase('loading', `Включаю ${trackLabel}…`);
    ensurePlayer().then(readyPlayer => {
      if (!readyPlayer || token !== request || !wantsPlayback || readyPlayer !== player) return;
      try {
        readyPlayer.setVolume(55);
        readyPlayer.unMute();
        mutedByApp = false;
        readyPlayer.playVideo();
      } catch {
        failPlayer(generation, 'Не удалось включить песню. Нажми «Ещё раз» или открой её на YouTube.');
      }
    }).catch(() => { /* ensurePlayer already shows the actionable error. */ });
  }
  function returnFocus() {
    const focusTarget = openButton.closest('[hidden]') ? document.querySelector('.site-frame') : openButton;
    focusTarget?.focus({ preventScroll: true });
  }
  function hidePlayer() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    openButton.setAttribute('aria-expanded', 'false');
    refreshAtmosphere();
    returnFocus();
  }

  openButton.addEventListener('click', () => {
    panel.inert = false;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    openButton.setAttribute('aria-expanded', 'true');
    refreshAtmosphere();
    if (!playerReady && !preparation) {
      if (isWebPage) setPhase('idle', 'Подключаю YouTube…');
      ensurePlayer().catch(() => { /* ensurePlayer already shows the actionable error. */ });
    }
    playButton.focus({ preventScroll: true });
  });
  closeButton.addEventListener('click', hidePlayer);
  stopButton.addEventListener('click', () => stopMusic(true));
  quickStopButton?.addEventListener('click', () => {
    stopMusic(true);
    returnFocus();
  });
  playButton.addEventListener('click', playMusic);
  effectsButton.addEventListener('click', () => {
    effectsEnabled = !effectsEnabled;
    effectsButton.setAttribute('aria-pressed', String(effectsEnabled));
    effectsButton.textContent = effectsEnabled ? '✧ Атмосфера: вкл.' : '✧ Атмосфера: выкл.';
    refreshAtmosphere();
  });
  reducedMotion.addEventListener('change', () => {
    clearNotes();
    if (atmosphereActive && !reducedMotion.matches) noteLoop();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen()) hidePlayer(); });
  document.addEventListener('visibilitychange', refreshAtmosphere);
  window.addEventListener('pagehide', () => stopMusic());
})();
