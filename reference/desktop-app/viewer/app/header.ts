// A small set of labeled disclosures keeps secondary controls off the scene toolbar.
import { $ } from './dom.ts';

// Toolbar button id -> popover id.
const headerPopovers = new Map([
  ['projectMenuBtn', 'projectPop'],
  ['viewOptionsBtn', 'viewOptionsPop'],
  ['infoBtn', 'infoPop'],
]);
let headerPopoverOwner: string | null = null;

const targetElement = (e: Event) => (e.target instanceof Element ? e.target : null);

export function closeHeaderPopovers({ restoreFocus = false } = {}) {
  const owner = headerPopoverOwner;
  headerPopoverOwner = null;
  for (const [button, popup] of headerPopovers) {
    $(popup).hidden = true;
    $(button).classList.remove('on');
    $(button).setAttribute('aria-expanded', 'false');
  }
  if (restoreFocus && owner) $(owner)?.focus();
}
function positionHeaderPopover(button: HTMLElement, popup: HTMLElement) {
  const header = document.querySelector('header')!.getBoundingClientRect(),
    control = button.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(control.left - header.left, header.width - popup.offsetWidth - 8))}px`;
}
function openHeaderPopover(button: string, { focus = true } = {}) {
  const popup = $(headerPopovers.get(button)!);
  closeHeaderPopovers();
  const owner = button === 'infoBtn' ? 'viewOptionsBtn' : button;
  headerPopoverOwner = owner;
  popup.hidden = false;
  $(button).classList.add('on');
  $(button).setAttribute('aria-expanded', 'true');
  positionHeaderPopover($(owner), popup);
  if (focus)
    popup
      .querySelector<HTMLElement>('button:not(:disabled):not([hidden]), select:not(:disabled), input:not(:disabled)')
      ?.focus();
}

export function initHeaderPopovers() {
  for (const [button, popup] of headerPopovers) {
    $(button).onclick = () => {
      if ($(popup).hidden) openHeaderPopover(button);
      else closeHeaderPopovers({ restoreFocus: true });
    };
    $(button).addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openHeaderPopover(button);
      }
    });
  }
  document.querySelectorAll<HTMLElement>('[data-back-options]').forEach(button => {
    button.onclick = () => openHeaderPopover('viewOptionsBtn');
  });
  $('projectPop').addEventListener('click', e => {
    if (targetElement(e)?.closest('button')) closeHeaderPopovers();
  });
  $('extra').addEventListener('click', e => {
    const button = targetElement(e)?.closest('button');
    if (button && !button.disabled && (button.id === 'previewCreation' || button.dataset.uiIcon === 'cannon'))
      closeHeaderPopovers({ restoreFocus: true });
  });
  document.addEventListener('pointerdown', e => {
    const target = targetElement(e);
    if (!target?.closest('.hdr-pop') && ![...headerPopovers.keys()].some(id => $(id).contains(target)))
      closeHeaderPopovers();
  });
  document.addEventListener('focusin', e => {
    const target = targetElement(e);
    if (headerPopoverOwner && !target?.closest('.hdr-pop') && !$(headerPopoverOwner).contains(target))
      closeHeaderPopovers();
  });
  document.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape' && headerPopoverOwner) {
        e.preventDefault();
        e.stopPropagation();
        closeHeaderPopovers({ restoreFocus: true });
      }
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (!headerPopoverOwner) return;
    const popup = document.querySelector<HTMLElement>('.hdr-pop:not([hidden])');
    if (popup) positionHeaderPopover($(headerPopoverOwner), popup);
  });
}
