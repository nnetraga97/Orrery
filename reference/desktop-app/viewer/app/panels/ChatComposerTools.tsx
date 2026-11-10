import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import * as codex from '../codex-chat.ts';
import { chatStore, type Chat } from '../codex-chat.ts';
import { Icon } from './Icon.tsx';
export const useChatState = <T,>(select: (chat: Chat) => T): T =>
  useSyncExternalStore(chatStore.subscribe, () => select(chatStore.get()));
export type ComposerMenu = 'add' | 'commands' | 'connectors' | 'plugins' | 'skills' | null;
const commands = [
  { name: 'compact', description: 'Free up context by summarizing this conversation' },
  { name: 'new', description: 'Start a new conversation in this project' },
  { name: 'review', description: 'Review uncommitted changes for bugs and regressions' },
  { name: 'plan', description: 'Switch to Plan mode: explore, ask questions, then plan' },
  { name: 'default', description: 'Switch back to working on the task' },
  { name: 'model', description: 'Choose a model and reasoning effort' },
  { name: 'permissions', description: 'Choose permissions for the next message' },
  { name: 'skills', description: 'Use an installed Codex skill' },
  { name: 'connectors', description: 'Add a connected app to this message' },
  { name: 'plugins', description: 'Use a skill from an installed plugin' },
];
export function useComposerMenu() {
  const prompt = useChatState(c => c.prompt),
    shown = useChatState(c => c.shown);
  const catalog = useChatState(c => c.integrations);
  const provider = useChatState(c => c.provider);
  const [menu, setMenu] = useState<ComposerMenu>(null),
    [active, setActive] = useState(0),
    [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const handle = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (['skills', 'connectors', 'plugins'].includes(name)) setMenu(name as ComposerMenu);
      else {
        const select = document.getElementById(
          name === 'model' ? 'codexModel' : 'codexPermission',
        ) as HTMLSelectElement;
        select?.focus();
        try {
          select?.showPicker();
        } catch {
          /* Keyboard selection remains available. */
        }
      }
    };
    window.addEventListener('galaxy-chat-command', handle);
    return () => window.removeEventListener('galaxy-chat-command', handle);
  }, []);
  useEffect(() => {
    setMenu(null);
    setDismissed(false);
  }, [shown]);
  useEffect(() => {
    setActive(0);
    setDismissed(false);
  }, [prompt, menu]);
  const slash = /^\/([^\s]*)$/.exec(prompt);
  const current = slash && !dismissed ? 'commands' : menu;
  const query = slash?.[1]?.toLowerCase() || '';
  const options =
    current === 'commands'
      ? [
          ...commands
            .filter(
              c => provider === 'codex' || !['plan', 'default', 'skills', 'connectors', 'plugins'].includes(c.name),
            )
            .map(c => ({
              id: `command:${c.name}`,
              name: c.name,
              label: `/${c.name}`,
              description: c.description,
            })),
          ...catalog.entries.filter(e => e.kind === 'skill').map(e => ({ ...e, label: `/${e.name}` })),
        ].filter(c => c.name.toLowerCase().includes(query))
      : catalog.entries.filter(e =>
          current === 'connectors'
            ? e.group === 'connector'
            : current === 'plugins'
              ? e.group === 'plugin'
              : e.group !== 'connector',
        );
  function choose(id: string) {
    const selected = options.find(option => option.id === id);
    if (selected && 'disabled' in selected && selected.disabled) return;
    setMenu(null);
    setDismissed(true);
    if (id.startsWith('command:')) {
      const name = id.slice(8);
      if (['skills', 'connectors', 'plugins'].includes(name)) {
        codex.setPrompt('');
        setMenu(name as ComposerMenu);
      } else if (name === 'model' || name === 'permissions') {
        codex.setPrompt('');
        const select = document.getElementById(
          name === 'model' ? 'codexModel' : 'codexPermission',
        ) as HTMLSelectElement;
        select?.focus();
        try {
          select?.showPicker();
        } catch {
          /* Keyboard focus still permits selection. */
        }
      } else {
        codex.setPrompt(`/${name} `);
        codex.focusPrompt();
      }
    } else {
      codex.selectIntegration(id);
      if (slash) codex.setPrompt('');
    }
  }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!current || current === 'add') return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      setMenu(null);
      setDismissed(true);
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => {
        if (!options.length) return 0;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        for (let n = 1; n <= options.length; n++) {
          const next = (i + step * n + options.length * n) % options.length;
          const option = options[next];
          if (!('disabled' in option) || !option.disabled) return next;
        }
        return i;
      });
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && options.length) {
      e.preventDefault();
      choose(options[active % options.length].id);
      return true;
    }
    return false;
  }
  return {
    current,
    options,
    active,
    choose,
    keyDown,
    setMenu,
    close: () => {
      setMenu(null);
      setDismissed(true);
    },
  };
}
export function ComposerTools({
  controls,
  disabled,
}: {
  controls: ReturnType<typeof useComposerMenu>;
  disabled: boolean;
}) {
  const { current, options, active, choose, setMenu, close } = controls;
  const provider = useChatState(c => c.provider);
  const loading = useChatState(c => c.integrationLoading),
    errors = useChatState(c => c.integrations.errors);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!current) return;
    const dismiss = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !(e.target as HTMLElement)?.closest('#codexPrompt')) close();
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        document.getElementById('codexAttach')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [current, close]);
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div className="codex-tools" ref={root}>
      <button
        id="codexAttach"
        className="codex-icon-button"
        type="button"
        aria-label="Add attachments and integrations"
        title="Add attachments and integrations"
        aria-expanded={!!current}
        aria-controls="codexComposerMenu"
        disabled={disabled}
        onClick={() => (current ? close() : setMenu('add'))}
      >
        <Icon name="plus" />
      </button>
      {current && (
        <div
          id="codexComposerMenu"
          className="codex-composer-menu"
          aria-label={current === 'add' ? 'Add to message' : current}
        >
          {current === 'add' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  void codex.chooseAttachments();
                }}
              >
                <Icon name="paperclip" />
                <span>Add files or photos</span>
                <kbd>Ctrl/⌘ U</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  void codex.chooseAttachments(true);
                }}
              >
                <Icon name="folder" />
                <span>Add folder</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu('commands');
                  codex.focusPrompt();
                }}
              >
                <Icon name="slash" />
                <span>Slash commands</span>
              </button>
              {provider === 'codex' && (
                <>
                  <div className="codex-menu-divider" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenu('connectors');
                      void codex.refreshIntegrations();
                    }}
                  >
                    <Icon name="layers" />
                    <span>Connectors</span>
                    <Icon name="chevron" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu('plugins');
                      void codex.refreshIntegrations();
                    }}
                  >
                    <Icon name="plug" />
                    <span>Plugins</span>
                    <Icon name="chevron" />
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="codex-menu-heading">
                <span>
                  {current === 'commands'
                    ? 'Commands & skills'
                    : current === 'plugins'
                      ? 'Installed plugin skills'
                      : current === 'connectors'
                        ? 'Connected apps'
                        : 'Installed skills'}
                </span>
                <button
                  type="button"
                  className="codex-icon-button"
                  aria-label="Refresh integrations"
                  onClick={codex.refreshIntegrations}
                >
                  <Icon name="refresh" />
                </button>
              </div>
              <div className="codex-menu-options" role="listbox" aria-label={current}>
                {options.map((option, i) => (
                  <button
                    key={option.id}
                    id={`codex-command-${i}`}
                    role="option"
                    aria-selected={active === i}
                    type="button"
                    disabled={'disabled' in option && !!option.disabled}
                    title={option.description}
                    onClick={() => choose(option.id)}
                  >
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
              {!options.length && (
                <p className="codex-menu-empty">
                  {loading
                    ? 'Loading integrations…'
                    : current === 'commands'
                      ? 'No matching commands or skills.'
                      : current === 'connectors'
                        ? 'No connected apps in this Codex account.'
                        : 'No enabled skills found. Install them in this project or Codex settings.'}
                </p>
              )}
              {!!errors.length && (
                <details className="codex-menu-errors">
                  <summary>Integration details</summary>
                  {errors.map((error, i) => (
                    <p key={`${i}:${error}`}>{error}</p>
                  ))}
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
export function AttachedContext() {
  const attachments = useChatState(c => c.attachments),
    mentions = useChatState(c => c.mentions),
    entries = useChatState(c => c.integrations.entries);
  if (!attachments.length && !mentions.length) return null;
  return (
    <div className="codex-attachments" aria-label="Attached context">
      {attachments.map(a => (
        <div key={a.id} className="codex-attachment" title={a.name}>
          {a.preview ? (
            <img src={a.preview} alt="" />
          ) : (
            <Icon name={a.kind === 'folder' ? 'folder' : a.kind === 'image' ? 'photo' : 'file'} />
          )}
          <span>{a.name}</span>
          <button type="button" aria-label={`Remove ${a.name}`} onClick={() => codex.removeAttachment(a.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      {mentions.map(id => {
        const entry = entries.find(e => e.id === id);
        return (
          <div key={id} className="codex-attachment">
            <Icon name={entry?.kind === 'connector' ? 'plug' : 'slash'} />
            <span>{entry?.label || id.split(':').slice(1).join(':').split('/').slice(-2, -1)[0] || id}</span>
            <button
              type="button"
              aria-label={`Remove ${entry?.label || 'integration'}`}
              onClick={() => codex.removeMention(id)}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
export function ComposerContext() {
  const project = useChatState(c => c.project),
    branch = useChatState(c => c.integrations.branch),
    changes = useChatState(c => c.integrations.changes);
  return (
    project && (
      <div className="codex-composer-context">
        <Icon name="folder" />
        <span title={project.root || project.path}>{project.name}</span>
        {branch && (
          <>
            <Icon name="branch" />
            <code title={branch}>{branch}</code>
          </>
        )}
        {!!changes?.files && (
          <button
            type="button"
            className="codex-change-count"
            title={`Review changes in ${changes.files} files`}
            aria-label={`Review project changes: ${changes.added} lines added, ${changes.removed} removed`}
            onClick={() => {
              codex.setPrompt('/review ');
              codex.focusPrompt();
            }}
          >
            <span>+{changes.added}</span>
            <span>−{changes.removed}</span>
          </button>
        )}
      </div>
    )
  );
}
