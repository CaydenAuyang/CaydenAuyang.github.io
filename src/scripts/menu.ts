// menu.ts: the full-screen section menu (Header.astro).
//
//   - Menu opens the <dialog> as a modal: the page behind is inert, so focus stays inside.
//   - Esc, Close, or tapping a section closes it. Esc and Close send focus back to Menu; a
//     section link jumps there and moves focus to that section.
//   - While it is open the page doesn't scroll (V4.md 8.2): <html> gets .menu-open (overflow:
//     hidden), and the timeline hears `world:scroll-lock` (detail.locked) and stops smooth
//     scrolling. Closing it without picking a section puts the page back exactly where it was,
//     since some phone browsers jump to the top when <html> stops scrolling.

const dialog = document.querySelector<HTMLDialogElement>('[data-menu]');
const openBtn = document.querySelector<HTMLButtonElement>('[data-menu-open]');
const closeBtn = dialog?.querySelector<HTMLButtonElement>('[data-menu-close]');
const html = document.documentElement;

function lock(locked: boolean) {
  html.classList.toggle('menu-open', locked);
  window.dispatchEvent(new CustomEvent('world:scroll-lock', { detail: { locked } }));
}

if (dialog && openBtn && typeof dialog.showModal === 'function') {
  // Where focus goes when the dialog closes: the Menu button, unless a section was picked.
  let returnTo: HTMLElement | null = openBtn;
  // The page's scroll position when the menu opened.
  let savedY = 0;

  openBtn.addEventListener('click', () => {
    returnTo = openBtn;
    savedY = window.scrollY;
    dialog.showModal();
    openBtn.setAttribute('aria-expanded', 'true');
    lock(true);
    dialog.querySelector<HTMLElement>('[data-menu-link]')?.focus();
  });

  closeBtn?.addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    openBtn.setAttribute('aria-expanded', 'false');
    lock(false);
    const target = returnTo;
    returnTo = openBtn;
    if (target === openBtn) {
      if (Math.abs(window.scrollY - savedY) > 1) window.scrollTo(0, savedY);
      openBtn.focus({ preventScroll: true });
      return;
    }
    if (!target) return;
    // Jump to the section (the overlay hides the jump), then hand it focus for screen readers
    // and keyboard users. One frame later, so the scroll lock has been released.
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
      if (target.id) history.replaceState(null, '', `#${target.id}`);
    });
  });

  dialog.querySelectorAll<HTMLAnchorElement>('[data-menu-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = link.hash.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      event.preventDefault();
      // Handled here: keep smooth-scroll anchor handlers from also animating the long trip.
      event.stopPropagation();
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      returnTo = target;
      dialog.close();
    });
  });
}
