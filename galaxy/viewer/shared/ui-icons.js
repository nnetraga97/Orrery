// Local SVGs keep the shared desktop, browser and extension toolbar offline.
export const UIIcons = (() => {
  const shapes = {
    error: '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8m0-8-8 8"/>',
    warning: '<path d="M12 3 2 21h20ZM12 9v5m0 3v1"/>',
    sidebarLeft: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16m-3-5V9"/>',
    sidebarRight: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M15 4v16m3-5V9"/>',
    collapse: '<path d="M8 4h12v12M4 8h12v12H4Zm3 6h6"/>',
    save: '<path d="M4 3h13l3 3v15H4Zm3 0v7h9V3M7 21v-8h10v8"/>',
    folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v2M3 7h5l2 2h11l-3 11H3Z"/>',
    folderPlus: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v13H3Z M12 10v7m-3-3.5h6"/>',
    agents:
      '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M1 12v4m22-4v4M9 16h6"/><circle cx="8.5" cy="11.5" r=".75"/><circle cx="15.5" cy="11.5" r=".75"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2"/>',
    constellation:
      '<path d="m5 18 4-12 10 5-5 8"/><circle cx="5" cy="18" r="2"/><circle cx="9" cy="6" r="2"/><circle cx="19" cy="11" r="2"/><circle cx="14" cy="19" r="1"/>',
    galaxy:
      '<path d="M12 12c-3-2-1-6 2-6 5 0 8 6 5 11-4 7-16 4-16-4C3 7 8 2 14 3m-2 9c3 2 1 6-2 6-5 0-8-6-5-11"/><circle cx="12" cy="12" r="1.5"/>',
    graph:
      '<path d="m6 6 12 12M6 18 18 6M6 6h12"/><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
    follow: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="1.5"/>',
    cannon: '<path d="m5 12 10-8 4 4-10 8Zm10-8 2-2 4 4-2 2M5 12l-2 5m6-1 1 4M2 21h11"/><circle cx="6" cy="17" r="2"/>',
    sparkles: '<path d="m14 3 2.5 6.5L23 12l-6.5 2.5L14 21l-2.5-6.5L5 12l6.5-2.5ZM4 2v6M1 5h6M4 17v5m-2.5-2.5h5"/>',
    traffic: '<path d="M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4"/>',
    orbit:
      '<ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="5" r="2"/>',
    bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="m8 3 2 4m6-4-2 4M3 9l4 2m-4 4h4m-4 6 5-3m13-9-4 2m4 4h-4m4 6-5-3M12 8v12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    connect: '<path d="m9 3 6 6m-9-3 6 6M7 5 3 9l6 6 4-4M7 13l-4 4v4m13-7v8m-4-4h8"/>',
    plug: '<path d="M8 2v5m8-5v5M6 7h12v4a6 6 0 0 1-12 0ZM12 17v5"/>',
    disconnected: '<path d="m3 3 18 18M8 2v3m8-3v5M6 7H4m8 0h6v4a6 6 0 0 1-.5 2.4M6 11a6 6 0 0 0 6 6v5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    session: '<path d="M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3ZM8 10h8m-4-4v8"/>',
  };
  shapes.search = '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>';
  // Agent actions in the chat transcript.
  Object.assign(shapes, {
    plus: '<path d="M12 4v16M4 12h16"/>',
    shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    // Camera presets: looking down, at 45 degrees, along the horizon, and at the selection.
    viewTop:
      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    viewAngle: '<path d="M3 19h18"/><path d="M5 19 18 6"/><path d="M13 6h5v5"/><path d="M9 19a5 5 0 0 0-1.5-3.5"/>',
    viewHorizon: '<path d="M2 15h20"/><path d="M5 15a7 7 0 0 1 14 0"/><path d="M12 4v2M5.6 6.6 7 8M18.4 6.6 17 8"/>',
    focus:
      '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="3"/>',
    paperclip: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2m-8 13 9-9"/>',
    slash: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m15 7-6 10"/>',
    photo:
      '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 5 5 4-4 4 4"/>',
    refresh: '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5m-3 9a9 9 0 0 0 15 2l3-3m0 5v-5h-5"/>',
    branch:
      '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-3c7 0 12-1 12-6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6m-6 4h4"/>',
    fileAdd:
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M12 11v6m-3-3h6"/>',
    fileRemove: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 14h6"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Zm9.5-13.5 4 4"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
    checklist: '<path d="m4 6 1.5 1.5L8 5m-4 7 1.5 1.5L8 11m-4 7 1.5 1.5L8 17M11 6h9m-9 6h9m-9 6h9"/>',
    thought:
      '<path d="M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z"/>',
    compress: '<path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5"/>',
    diff: '<path d="M8 3v12m-4-4h8M16 9v12m-4-4h8"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    newChat:
      '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M18.4 3.6a2 2 0 0 1 2.9 2.9L13 15l-4 1 1-4Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrowUp: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    breakpoints: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/>',
    resume: '<path d="M5 5v14"/><path d="m9 5 10 7-10 7Z"/>',
    pause: '<path d="M8 5v14m8-14v14"/>',
    stepOver: '<path d="M4 13a8 8 0 0 1 15-3"/><path d="M20 5v5h-5"/><circle cx="12" cy="18" r="1.5"/>',
    stepInto: '<path d="M12 3v11m-4-4 4 4 4-4"/><circle cx="12" cy="19" r="1.5"/>',
    stepOut: '<path d="M12 15V4m-4 4 4-4 4 4"/><circle cx="12" cy="19" r="1.5"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
    chats: '<path d="M8 9h8m-8 4h5M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/>',
    alert: '<path d="M12 3 2 20h20Zm0 7v4m0 3v.5"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
  });
  const shape = name => shapes[name] || shapes.info;
  const svg = name =>
    `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shape(name)}</svg>`;
  function set(element, name, label, { text, pressed } = {}) {
    element.removeAttribute('data-icon');
    if (element.dataset.uiIcon !== name || element.dataset.uiText !== (text || '')) {
      element.innerHTML = svg(name); // Icon geometry is local constant data; labels stay text.
      if (text) {
        const caption = document.createElement('span');
        caption.textContent = text;
        element.append(caption);
      }
      element.dataset.uiIcon = name;
      element.dataset.uiText = text || '';
    }
    element.classList.add(element.tagName === 'BUTTON' ? 'icon-button' : 'icon-label');
    element.setAttribute('aria-label', label);
    element.title = label;
    if (pressed !== undefined) element.setAttribute('aria-pressed', String(pressed));
  }
  document.addEventListener('DOMContentLoaded', () => {
    document
      .querySelectorAll('[data-icon]')
      .forEach(element =>
        set(element, element.dataset.icon, element.getAttribute('aria-label') || element.textContent.trim(), {
          text: element.dataset.iconText,
        }),
      );
  });
  return { set, svg, shape };
})();
