(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reveals = [...document.querySelectorAll('[data-reveal]')];
  if (!reveals.length || reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    }
  }, { threshold: .08, rootMargin: '0px 0px -16px 0px' });
  document.documentElement.classList.add('polish-ready');
  reveals.forEach(element => observer.observe(element));
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    reveals.forEach(element => element.classList.add('is-revealed'));
    observer.disconnect();
  });
})();
