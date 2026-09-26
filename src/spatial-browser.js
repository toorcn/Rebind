import { paymentView } from './payment-view-model.mjs';

let sceneModule;
const scenes = [];
for (const root of document.querySelectorAll('[data-spatial]')) {
  let scene = null, loading = false, separate = false, model, disposed = false, expiryTimer;
  function read() {
    if (root.dataset.spatial === 'people') return {
      mode: 'people', key: 'people', separate, phase: separate ? 'ready' : 'blocked',
      status: separate ? 'Two agents, two different people.' : 'Two agents, one person.',
      detail: separate ? 'After delivery and verification, payment can be released.' : 'Payment stays locked, even when both agents finish their work.',
    };
    let job;
    try { job = JSON.parse(root.dataset.job); } catch { job = null; }
    return { ...paymentView(root.dataset.spatial, job), mode: root.dataset.spatial, key: job?.id ?? 'empty', expiresAt: job?.expiredAt };
  }
  function update() {
    model = read(); root.dataset.phase = model.phase;
    root.querySelector('.sv-status').textContent = model.status + (model.mode !== 'people' && model.phase !== 'empty' ? ' · ' + model.amount + ' ' + model.unit : '');
    root.querySelector('.sv-detail').textContent = model.detail;
    const reason = root.querySelector('.sv-reason'); if (reason) reason.textContent = model.reason;
    const fallback = root.querySelector('.sv-fallback');
    fallback.children[0].textContent = model.mode === 'people' ? (separate ? 'Person A → Buyer · Person B → Worker' : 'One person → Buyer & worker') : 'Buyer → Escrow → Worker';
    fallback.children[1].textContent = model.status.replace(/\.$/, '') + '. ' + model.detail;
    scene?.update(model);
    clearTimeout(expiryTimer);
    const remaining = model.expiresAt * 1000 - Date.now();
    if (model.mode === 'wallet' && remaining > 0) expiryTimer = setTimeout(update, Math.min(remaining + 20, 2147483647));
  }
  root.querySelectorAll('[data-people]').forEach(button => button.addEventListener('click', () => {
    separate = button.dataset.people === 'different';
    root.querySelectorAll('[data-people]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    update();
  }));
  update();
  const observer = new MutationObserver(update);
  observer.observe(root, { attributes: true, attributeFilter: ['data-job'] });
  const visibility = new IntersectionObserver(async entries => {
    if (!entries.some(entry => entry.isIntersecting) || scene || loading) return;
    loading = true;
    try {
      sceneModule ||= import('./spatial-scene.js');
      const { mountScene } = await sceneModule;
      if (!disposed) scene = mountScene(root, model);
    } catch (error) {
      // Text and native controls remain usable when WebGL is unavailable.
      root.querySelector('canvas')?.remove();
      console.warn('3D view unavailable:', error);
    }
    visibility.disconnect();
  }, { rootMargin: '100px' });
  visibility.observe(root);
  scenes.push(() => { disposed = true; clearTimeout(expiryTimer); observer.disconnect(); visibility.disconnect(); scene?.dispose(); });
}
window.addEventListener('pagehide', event => { if (!event.persisted) scenes.forEach(dispose => dispose()); });
