// contact.ts: the two clocks, Copy email, and the email's extra arc (Contact.astro, 11b.7).

import { ui } from '../data/site';

// ---- Clocks: each city's local time, from the visitor's own clock, on the minute ----------------
const clocks = Array.from(document.querySelectorAll<HTMLElement>('[data-clock]'))
  .map((el) => {
    try {
      const format = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: el.dataset.clock });
      return { el, format };
    } catch {
      return null; // a browser without that time zone: the line stays empty and hidden
    }
  })
  .filter((c): c is { el: HTMLElement; format: Intl.DateTimeFormat } => !!c);

if (clocks.length) {
  let timer = 0;
  const tick = () => {
    const now = new Date();
    for (const { el, format } of clocks) el.textContent = format.format(now);
    window.clearTimeout(timer);
    // Just after the next minute begins.
    timer = window.setTimeout(tick, 60_000 - (now.getTime() % 60_000) + 50);
  };
  tick();
  // Timers sleep in a hidden tab; catch up when it's shown again.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}

// ---- Copy email --------------------------------------------------------------------------------
const copyButton = document.querySelector<HTMLButtonElement>('[data-copy-email]');
const status = document.querySelector<HTMLElement>('[data-copy-status]');

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (a sandboxed frame without clipboard access): try the old way.
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

if (copyButton) {
  const email = copyButton.dataset.copyEmail || '';
  let reset = 0;
  copyButton.addEventListener('click', async () => {
    const ok = await copyText(email);
    copyButton.focus({ preventScroll: true });
    if (!ok) {
      // Nothing could write to the clipboard: select the address so a keyboard copy works.
      const address = document.querySelector('.contact__email')?.lastChild;
      const selection = window.getSelection();
      if (address && selection) {
        const range = document.createRange();
        range.selectNodeContents(address);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return;
    }
    copyButton.textContent = ui.copied;
    copyButton.dataset.copied = '';
    if (status) status.textContent = ui.copied;
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      copyButton.textContent = ui.copyEmail;
      delete copyButton.dataset.copied;
      if (status) status.textContent = '';
    }, 2000);
  });
}

// ---- The email sends an extra light along the arc ----------------------------------------------
const emailLink = document.querySelector<HTMLElement>('.contact__email');
if (emailLink) {
  let last = 0;
  const arc = () => {
    const now = performance.now();
    if (now - last < 900) return;
    last = now;
    window.dispatchEvent(new CustomEvent('world:arc'));
  };
  emailLink.addEventListener('pointerenter', arc);
  emailLink.addEventListener('focus', arc);
}

// ---- Lights: the harbour light show (11b.9) -----------------------------------------------------
// Shown only once the scene's interactions run (html.has-interactions), with motion on, never in
// snapshot or without WebGL. The scene answers with `world:lights-state` ({ on }), which drives
// aria-pressed, including when the show ends by itself or a scroll stops it.
const html = document.documentElement;
const lightsWrap = document.querySelector<HTMLElement>('[data-lights-wrap]');
const lightsButton = document.querySelector<HTMLButtonElement>('[data-lights]');

if (lightsWrap && lightsButton && !html.hasAttribute('data-snapshot')) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const showIfAble = () => {
    const able = html.classList.contains('has-interactions') && !html.classList.contains('no-webgl') && !reduce.matches;
    lightsWrap.classList.toggle('is-on', able);
  };
  new MutationObserver(showIfAble).observe(html, { attributes: true, attributeFilter: ['class'] });
  reduce.addEventListener?.('change', showIfAble);
  showIfAble();

  lightsButton.addEventListener('click', () => window.dispatchEvent(new CustomEvent('world:lights')));
  window.addEventListener('world:lights-state', (event) => {
    const on = !!(event as CustomEvent<{ on: boolean }>).detail?.on;
    lightsButton.setAttribute('aria-pressed', String(on));
  });
}
