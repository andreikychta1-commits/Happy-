(() => {
  'use strict';
  const section = document.getElementById('secret-garden');
  if (!section) return;
  const trigger = document.getElementById('gp-open');
  const closeButton = document.getElementById('gp-close');
  const garden = document.getElementById('gp-garden');
  const world = document.getElementById('gp-world');
  const sun = document.getElementById('gp-sun');
  const innerGarden = document.getElementById('gp-inner-garden');
  const backButton = document.getElementById('gp-inner-back');
  const openContent = document.getElementById('gp-open-content');
  const hint = document.getElementById('gp-hint');
  const note = document.getElementById('gp-note');
  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const flowers = [...section.querySelectorAll('[data-flower]')];
  const notes = {
    peony:'Пионы — для твоих самых смелых мечтаний. Пусть жизнь раскрывается перед тобой так же щедро и красиво.',
    lotus:'Лотосы — для спокойствия в твоём сердце. Пусть рядом всегда будет тот, с кем можно просто быть собой.',
    wisteria:'Глициния — для нежности, которая не заканчивается. Пусть каждый день обнимает тебя чем-нибудь хорошим.'
  };
  let outerNote = note.textContent;
  let isOpen = false;
  let phase = 'closed';
  let enterAfterOpening = false;
  let transitionTimer = 0;
  let transitionCompletion = null;
  let pointerFrame = 0;
  let pointerX = 0;
  let pointerY = 0;

  // The small opening contains the same paper artwork as the destination.
  const preview = innerGarden.querySelector('.gp-inner-scene').cloneNode(true);
  preview.setAttribute('aria-hidden', 'true');
  preview.querySelectorAll('[id],[tabindex]').forEach(element => {
    element.removeAttribute('id');
    element.removeAttribute('tabindex');
  });
  preview.querySelectorAll('img').forEach(image => { image.loading = 'eager'; });
  sun.querySelector('.gp-sun-preview').appendChild(preview);

  function animateMotion() {
    return !reducedMotion.matches && !document.hidden && !root.classList.contains('motion-paused')
      && !section.classList.contains('gp-still') && !section.classList.contains('gp-camera-still');
  }
  function canMoveLayers() {
    return isOpen && ['closed','opening','open'].includes(phase) && finePointer.matches && animateMotion();
  }
  function resetLayers() {
    if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    garden.style.setProperty('--gp-pointer-x', '0');
    garden.style.setProperty('--gp-pointer-y', '0');
  }
  function updateLayers() {
    pointerFrame = 0;
    if (!canMoveLayers()) { resetLayers(); return; }
    const bounds = garden.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(-1, Math.min(1, (pointerX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (pointerY - bounds.top) / bounds.height * 2 - 1));
    garden.style.setProperty('--gp-pointer-x', x.toFixed(3));
    garden.style.setProperty('--gp-pointer-y', y.toFixed(3));
  }
  function setPhase(value) {
    phase = value;
    sun.dataset.state = value;
    sun.setAttribute('aria-busy', String(['opening','entering','returning'].includes(value)));
  }
  function clearTransition() {
    window.clearTimeout(transitionTimer);
    transitionTimer = 0;
    transitionCompletion = null;
  }
  function finishAfter(duration, complete) {
    clearTransition();
    if (!animateMotion()) { complete(); return; }
    transitionCompletion = complete;
    transitionTimer = window.setTimeout(() => {
      transitionTimer = 0;
      transitionCompletion = null;
      complete();
    }, duration);
  }
  function settleTransition() {
    if (!transitionCompletion) return;
    const complete = transitionCompletion;
    clearTransition();
    section.classList.add('gp-camera-still');
    complete();
    // Commit the destination before restoring transitions, including in a hidden tab.
    void world.offsetWidth;
    section.classList.remove('gp-camera-still');
  }
  function setCamera(zoomed) {
    if (!zoomed) {
      world.style.setProperty('--gp-camera-x', '0px');
      world.style.setProperty('--gp-camera-y', '0px');
      world.style.setProperty('--gp-camera-scale', '1');
      return;
    }
    const width = world.clientWidth;
    const height = world.clientHeight;
    const diameter = sun.offsetWidth;
    if (!width || !height || !diameter) return;
    const centerX = sun.offsetLeft + diameter / 2;
    const centerY = sun.offsetTop + sun.offsetHeight / 2;
    world.style.transformOrigin = centerX + 'px ' + centerY + 'px';
    world.style.setProperty('--gp-camera-x', (width / 2 - centerX) + 'px');
    world.style.setProperty('--gp-camera-y', (height / 2 - centerY) + 'px');
    world.style.setProperty('--gp-camera-scale', String(Math.hypot(width, height) / diameter * 1.12));
  }
  function resetPortal() {
    clearTransition();
    enterAfterOpening = false;
    const restoreSunFocus = innerGarden.contains(document.activeElement);
    if (restoreSunFocus) garden.focus({ preventScroll:true });
    section.classList.add('gp-camera-still');
    section.classList.remove('gp-sun-open','gp-sun-travelling','gp-inner-active','gp-sun-returning');
    innerGarden.inert = true;
    innerGarden.setAttribute('aria-hidden', 'true');
    world.inert = false;
    world.removeAttribute('aria-hidden');
    setCamera(false);
    sun.setAttribute('aria-expanded', 'false');
    sun.setAttribute('aria-label', 'Открыть солнце — за ним ещё один сад');
    sun.removeAttribute('aria-disabled');
    setPhase('closed');
    note.textContent = outerNote;
    void world.offsetWidth;
    section.classList.remove('gp-camera-still');
    if (restoreSunFocus && isOpen) sun.focus({ preventScroll:true });
  }
  function closeSun() {
    clearTransition();
    enterAfterOpening = false;
    section.classList.remove('gp-sun-open');
    sun.setAttribute('aria-expanded', 'false');
    sun.setAttribute('aria-label', 'Открыть солнце — за ним ещё один сад');
    setPhase('closed');
    note.textContent = outerNote;
    sun.focus({ preventScroll:true });
  }
  function enterGarden() {
    if (!isOpen || phase !== 'open') return;
    setPhase('entering');
    sun.setAttribute('aria-disabled', 'true');
    resetLayers();
    garden.focus({ preventScroll:true });
    world.inert = true;
    world.setAttribute('aria-hidden', 'true');
    section.classList.add('gp-sun-travelling');
    setCamera(true);
    note.textContent = 'Сквозь тёплый свет — в ещё один маленький сад…';
    finishAfter(4250, () => {
      section.classList.add('gp-inner-active');
      section.classList.remove('gp-sun-travelling');
      innerGarden.inert = false;
      innerGarden.setAttribute('aria-hidden', 'false');
      setPhase('inside');
      note.textContent = 'Ещё один сад, в котором всё цветёт для тебя.';
      backButton.focus({ preventScroll:true });
    });
  }
  function returnToSun() {
    if (!['entering','inside'].includes(phase)) return;
    clearTransition();
    setPhase('returning');
    garden.focus({ preventScroll:true });
    innerGarden.inert = true;
    innerGarden.setAttribute('aria-hidden', 'true');
    section.classList.add('gp-sun-returning');
    section.classList.remove('gp-inner-active','gp-sun-travelling');
    setCamera(false);
    note.textContent = 'Возвращаемся к нашему маленькому солнцу…';
    finishAfter(2850, () => {
      section.classList.remove('gp-sun-returning');
      world.inert = false;
      world.removeAttribute('aria-hidden');
      sun.removeAttribute('aria-disabled');
      setPhase('open');
      note.textContent = 'Солнце открыто. Коснись его ещё раз, чтобы войти в сад.';
      sun.focus({ preventScroll:true });
      resetLayers();
    });
  }
  function setOpen(open) {
    isOpen = open;
    section.classList.toggle('gp-is-open', open);
    // Move focus outside before making both gardens inert.
    if (!open) {
      trigger.focus({ preventScroll:true });
      resetPortal();
    }
    trigger.setAttribute('aria-expanded', String(open));
    garden.setAttribute('aria-hidden', String(!open));
    garden.inert = !open;
    openContent.hidden = !open;
    hint.hidden = open;
    if (open) closeButton.focus({ preventScroll:true });
    resetLayers();
  }
  sun.addEventListener('click', () => {
    if (!isOpen) return;
    if (phase === 'opening') { enterAfterOpening = true; return; }
    if (phase === 'open') { enterGarden(); return; }
    if (phase !== 'closed') return;
    setPhase('opening');
    section.classList.add('gp-sun-open');
    sun.setAttribute('aria-expanded', 'true');
    sun.setAttribute('aria-label', 'Войти через открытое солнце во второй сад');
    note.textContent = 'Солнце открывается как маленькие двери. Ещё одно касание — и ты внутри.';
    finishAfter(1850, () => {
      setPhase('open');
      note.textContent = 'Солнце открыто. Коснись его ещё раз, чтобы войти в сад.';
      if (enterAfterOpening) { enterAfterOpening = false; enterGarden(); }
    });
  });
  backButton.addEventListener('click', returnToSun);
  trigger.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  section.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !isOpen) return;
    event.preventDefault();
    if (['entering','inside'].includes(phase)) returnToSun();
    else if (phase === 'returning') settleTransition();
    else if (['opening','open'].includes(phase)) closeSun();
    else setOpen(false);
  });
  flowers.forEach(button => {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      flowers.forEach(flower => flower.setAttribute('aria-pressed', String(flower.dataset.flower === button.dataset.flower)));
      outerNote = notes[button.dataset.flower];
      note.textContent = outerNote;
    });
  });
  garden.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !canMoveLayers()) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!pointerFrame) pointerFrame = window.requestAnimationFrame(updateLayers);
  });
  garden.addEventListener('pointerleave', resetLayers);
  function motionChanged() {
    resetLayers();
    if (!animateMotion()) settleTransition();
  }
  reducedMotion.addEventListener('change', motionChanged);
  finePointer.addEventListener('change', resetLayers);
  document.addEventListener('visibilitychange', motionChanged);
  window.addEventListener('resize', () => {
    resetLayers();
    settleTransition();
    if (phase === 'inside') setCamera(true);
  });
  window.addEventListener('pagehide', resetPortal);
  if ('MutationObserver' in window) {
    new MutationObserver(motionChanged).observe(root, { attributes:true, attributeFilter:['class'] });
  }
  resetPortal();
  resetLayers();
})();
