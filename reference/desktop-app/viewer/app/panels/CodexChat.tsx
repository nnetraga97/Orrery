// Electron's conversation surface: project chats, the Codex account, the transcript and the composer.
// State and operations live in ../codex-chat.ts; projects.js drives it through the CodexChat object below.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as codex from '../codex-chat.ts';
import {
  PROVIDERS,
  chatStore,
  effortValue,
  message,
  modelId,
  providerName,
  running,
  signedIn,
  type Chat,
} from '../codex-chat.ts';
import { Conversation, RequestCard } from './CodexTranscript.tsx';
import { Icon } from './Icon.tsx';
import { AttachedContext, ComposerContext, ComposerTools, useComposerMenu } from './ChatComposerTools.tsx';

function useChat<T>(select: (chat: Chat) => T): T {
  return useSyncExternalStore(chatStore.subscribe, () => select(chatStore.get()));
}
const useSignedIn = () => useChat(signedIn);

function ChatPanel() {
  return (
    <>
      <Heading />
      <Context />
      <ChatList />
      <Auth />
      <Transcript />
      <Footer />
    </>
  );
}

function Heading() {
  const listOpen = useChat(c => c.listOpen);
  const disabled = useChat(c => c.busy || !signedIn(c) || !c.project || !c.codex.available);
  return (
    <div className="codex-heading">
      <button
        className="codex-chats-toggle"
        id="codexChats"
        aria-expanded={listOpen}
        aria-controls="codexChatList"
        onClick={codex.toggleList}
      >
        <Icon name="chats" />
        <span>Chats</span>
        <span className={`codex-caret${listOpen ? ' open' : ''}`} aria-hidden="true">
          <Icon name="chevron" />
        </span>
      </button>
      <div className="codex-heading-actions">
        <button
          id="codexNewChat"
          className="codex-icon-button"
          title="New chat"
          aria-label="New chat"
          disabled={disabled}
          onClick={codex.newChat}
        >
          <Icon name="newChat" />
        </button>
        <button
          id="codexClose"
          className="codex-icon-button"
          title="Collapse Chats"
          aria-label="Collapse Chats"
          onClick={codex.closePanel}
        >
          <Icon name="sidebarRight" />
        </button>
      </div>
    </div>
  );
}

function Context() {
  const agentName = useChat(providerName);
  const project = useChat(c => c.project);
  const codexState = useChat(c => c.codex);
  const provider = useChat(c => c.provider);
  const busy = useChat(c => c.busy);
  const signed = useSignedIn();
  const claude = provider === 'claude';
  const nemotron = provider === 'nemotron';
  const account = codexState.account;
  const name =
    account?.email ||
    (/api.?key/i.test(account?.type || '') ? 'API key account' : claude ? 'Claude account' : 'ChatGPT account');
  return (
    <div className="codex-context">
      <span id="codexProject" title={project?.root || project?.path || project?.name || ''}>
        {project?.name || 'No project open'}
      </span>
      <details className="codex-account">
        <summary id="codexAccountLabel">
          {agentName} · {signed ? name : 'Account'}
        </summary>
        <div className="codex-account-menu">
          <div className="codex-provider" role="radiogroup" aria-label="Agent">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                id={`chatProvider-${p.id}`}
                type="button"
                role="radio"
                aria-checked={provider === p.id}
                disabled={busy}
                onClick={() => codex.setProvider(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <strong id="codexAccountEmail">
            {nemotron
              ? 'Uses your Nebius Token Factory key'
              : signed
                ? name
                : claude
                  ? 'Uses your Claude Code login'
                  : 'Sign in with your ChatGPT account'}
          </strong>
          <small id="codexAccountPlan">
            {nemotron
              ? 'NEBIUS_API_KEY or ~/.config/nebius/api_key'
              : account?.planType
                ? `${account.planType} plan`
                : claude
                  ? 'Sign in with `claude` in a terminal'
                  : 'Codex in Galaxy'}
          </small>
          <button id="codexAccountSignIn" hidden={signed || claude || nemotron} disabled={busy} onClick={codex.signIn}>
            Sign in to Codex
          </button>
          <button id="codexSignOut" hidden={!signed || claude || nemotron} disabled={busy} onClick={codex.signOut}>
            Sign out
          </button>
        </div>
      </details>
    </div>
  );
}

function ChatList() {
  const open = useChat(c => c.listOpen);
  const project = useChat(c => c.project);
  const threads = useChat(c => c.codex.threads);
  const selected = useChat(c => c.thread?.id);
  return (
    <nav id="codexChatList" className="codex-chat-list" aria-label="Project chats" hidden={!open}>
      <div className="codex-list-label">{project ? `Chats in ${project.name}` : 'Project chats'}</div>
      {!threads?.length && <p className="codex-muted">Your conversations will appear here.</p>}
      {threads?.map(t => (
        <button
          key={t.id}
          type="button"
          className={`codex-chat-row${t.id === selected ? ' selected' : ''}`}
          aria-current={t.id === selected ? 'true' : 'false'}
          onClick={() => codex.readChat(t.id)}
        >
          <span>{t.title || 'New chat'}</span>
          {(t.status === 'running' || t.status === 'waiting') && (
            <small>{t.status === 'waiting' ? 'Needs input' : 'Working'}</small>
          )}
        </button>
      ))}
    </nav>
  );
}

function Auth() {
  const signed = useSignedIn();
  const available = useChat(c => c.codex.available);
  const login = useChat(c => c.codex.login);
  const busy = useChat(c => c.busy);
  const claude = useChat(c => c.provider === 'claude');
  const nemotron = useChat(c => c.provider === 'nemotron');
  const waiting = !!login && !['complete', 'completed', 'cancelled', 'failed'].includes(login.status || '');
  const unavailable = available === false;
  if (nemotron)
    return (
      <div id="codexAuth" className="codex-auth" hidden={signed}>
        <div className="codex-wordmark">Nemotron</div>
        <h2 id="codexAuthTitle">Connect Nebius Token Factory</h2>
        <p id="codexAuthHint">
          Set NEBIUS_API_KEY before launching Galaxy, or save your key in ~/.config/nebius/api_key, then choose Check
          again.
        </p>
        <button id="codexRetry" className="codex-primary" disabled={busy} onClick={codex.retry}>
          Check again
        </button>
      </div>
    );
  // Claude Code signs in through its own CLI; Galaxy only reads whether it is signed in.
  if (claude)
    return (
      <div id="codexAuth" className="codex-auth" hidden={signed}>
        <div className="codex-wordmark">Claude Code</div>
        <h2 id="codexAuthTitle">{unavailable ? 'Claude Code is not installed' : 'Log in to Claude Code'}</h2>
        <p id="codexAuthHint">
          {unavailable
            ? 'Install the Claude Code CLI, or set GALAXY_CLAUDE_BIN to its path, then retry.'
            : 'Run `claude` in a terminal and log in, or set ANTHROPIC_API_KEY. Galaxy uses that login.'}
        </p>
        <button id="codexRetry" className="codex-primary" disabled={busy} onClick={codex.retry}>
          Check again
        </button>
      </div>
    );
  return (
    <div id="codexAuth" className="codex-auth" hidden={signed}>
      <div className="codex-wordmark">Codex</div>
      <h2 id="codexAuthTitle">
        {unavailable ? 'Codex is unavailable' : waiting ? 'Finish signing in' : 'Build with Codex'}
      </h2>
      <p id="codexAuthHint">
        {unavailable
          ? 'Check the connection message below, then retry Codex.'
          : waiting
            ? 'Complete the sign-in page opened in your browser. This chat will be ready when you return.'
            : 'Sign in with ChatGPT to start conversations and work on your project here.'}
      </p>
      <button
        id="codexSignIn"
        className="codex-primary"
        hidden={waiting || unavailable}
        disabled={unavailable || busy}
        onClick={codex.signIn}
      >
        Sign in with ChatGPT
      </button>
      <button id="codexCancelLogin" hidden={!waiting} disabled={busy} onClick={codex.cancelLogin}>
        Cancel sign-in
      </button>
      <button id="codexRetry" hidden={!unavailable} onClick={codex.retry}>
        Retry connection
      </button>
    </div>
  );
}

function Transcript() {
  const agentName = useChat(providerName);
  const signed = useSignedIn();
  const project = useChat(c => c.project);
  const thread = useChat(c => c.thread);
  const live = useChat(running);
  const shown = useChat(c => c.shown);
  const box = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is at (or near) the end.
  const following = useRef(true);
  const items = thread?.items || [];
  const toEnd = () =>
    requestAnimationFrame(() => {
      if (box.current) box.current.scrollTop = box.current.scrollHeight;
    });
  useLayoutEffect(() => {
    following.current = true;
    toEnd();
  }, [shown]);
  useLayoutEffect(() => {
    if (following.current) toEnd();
  }, [items]);
  return (
    <div
      id="codexTranscript"
      className="codex-transcript"
      role="log"
      aria-label={`${agentName} conversation`}
      aria-live="off"
      hidden={!signed}
      ref={box}
      onScroll={e => {
        const b = e.currentTarget;
        following.current = b.scrollHeight - b.scrollTop - b.clientHeight < 90;
      }}
    >
      <div id="codexWelcome" className="codex-welcome" hidden={!!items.length || !signed}>
        <h2 id="codexWelcomeTitle">
          {project ? 'What would you like to build?' : 'Bring your codebase into the conversation'}
        </h2>
        <p id="codexWelcomeHint">
          {project
            ? `${agentName} works in ${project.name}. File changes will appear in its galaxy.`
            : `Open a project to give ${agentName} a workspace.`}
        </p>
        <button id="codexOpenProject" hidden={!!project} onClick={codex.openProject}>
          Open project
        </button>
      </div>
      <h2
        id="codexTitle"
        className="codex-conversation-title"
        hidden={!items.length}
        title={thread?.title || 'New chat'}
      >
        {thread?.title || 'New chat'}
      </h2>
      <div id="codexMessages">{thread && <Conversation thread={thread} live={live} />}</div>
      <div id="codexRequests">
        {(thread?.requests || []).map(request => (
          // A changed request is a new card, as before: its answers start empty.
          <RequestCard key={JSON.stringify(request)} request={request} />
        ))}
      </div>
    </div>
  );
}

// While a turn runs, the transcript's last line says what the agent is doing; the footer keeps what needs the reader.
function statusOf(c: Chat) {
  const t = c.thread;
  if (t?.reconnecting) return t.reconnecting;
  if (t?.requests?.length) return 'Waiting for your response';
  if (t?.status === 'interrupted') return 'Stopped';
  if (t?.status === 'error') return 'Turn failed';
  return '';
}

function Footer() {
  const status = useChat(statusOf);
  const error = useChat(c => c.error || c.connectionError || message(c.thread?.error));
  return (
    <div className="codex-footer">
      <div id="codexStatus" className="codex-working" role="status" hidden={!status}>
        {status}
      </div>
      <div id="codexError" className="codex-error" role="alert" hidden={!error}>
        {error}
      </div>
      <Composer />
      <ComposerNote />
    </div>
  );
}

function ComposerNote() {
  const live = useChat(running);
  return (
    <div className="codex-composer-note">
      {live ? 'Enter for follow-up options' : 'Enter to send'} · Shift + Enter for a new line
    </div>
  );
}

const permissionNames = { 'read-only': 'Read only', 'workspace-write': 'Workspace', 'full-access': 'Full access' };
function QueuedMessages() {
  const queued = useChat(c => c.thread?.queued);
  const paused = useChat(c => c.thread?.queuePaused);
  const busy = useChat(c => c.busy);
  const hasDraft = useChat(c => !!c.prompt.trim() || !!c.attachments.length || !!c.mentions.length);
  if (!queued?.length) return null;
  return (
    <section className="codex-queue" aria-label="Queued messages">
      <div className="codex-queue-heading">
        <span>
          {queued.length} queued{paused ? ' · Paused' : ''}
        </span>
        {paused && (
          <button type="button" disabled={busy || queued[0].state === 'failed'} onClick={codex.resumeQueue}>
            Resume queue
          </button>
        )}
      </div>
      <ol>
        {queued.map(item => (
          <li key={item.id}>
            <p>{item.text}</p>
            {!!item.attachmentInfo?.length && <small>{item.attachmentInfo.map(a => a.name).join(' · ')}</small>}
            <div className="codex-queue-actions">
              <small>
                {permissionNames[item.permission]}
                {item.state === 'sending' ? ' · Sending…' : item.state === 'failed' ? ' · Delivery failed' : ''}
              </small>
              <button
                type="button"
                disabled={busy || item.state === 'sending' || hasDraft}
                title={hasDraft ? 'Send or clear your draft before editing' : 'Edit queued message'}
                onClick={() => codex.removeQueued(item, true)}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy || item.state === 'sending'}
                onClick={() => codex.removeQueued(item)}
              >
                Remove
              </button>
            </div>
            {item.error && <small className="codex-error">{item.error}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Composer() {
  const agentName = useChat(providerName);
  const menu = useComposerMenu();
  const prompt = useChat(c => c.prompt);
  const project = useChat(c => c.project);
  const signed = useSignedIn();
  const available = useChat(c => c.codex.available);
  const busy = useChat(c => c.busy);
  const isRunning = useChat(running);
  const stopping = useChat(c => c.stopping);
  const turnId = useChat(c => c.thread?.turnId);
  const threadId = useChat(c => c.thread?.id);
  const [followUpTurn, setFollowUpTurn] = useState<string | null>(null);
  const hasContext = useChat(c => !!c.attachments.length || !!c.mentions.length);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    codex.setPromptElement(input.current);
    return () => codex.setPromptElement(null);
  }, []);
  const writable = signed && !!project && !!available;
  const hasDraft = !!prompt.trim() || hasContext;
  const turnKey = `${threadId}:${turnId}`;
  const choosing = isRunning && followUpTurn === turnKey && hasDraft;
  const dismissChoices = () => {
    setFollowUpTurn(null);
    codex.focusPrompt();
  };
  const submitDraft = () => {
    if (busy || !writable || !hasDraft) return;
    if (isRunning && !prompt.startsWith('/')) {
      setFollowUpTurn(turnKey);
      requestAnimationFrame(() => document.getElementById('codexQueue')?.focus());
    } else codex.send();
  };
  return (
    <form
      id="codexComposer"
      className="codex-composer"
      onKeyDown={e => {
        if (e.key === 'Escape' && choosing) {
          e.preventDefault();
          dismissChoices();
        }
      }}
      onDragOver={e => {
        if (writable && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={e => {
        if (writable && e.dataTransfer.files.length) {
          e.preventDefault();
          void codex.attachFiles(Array.from(e.dataTransfer.files));
        }
      }}
      onSubmit={e => {
        e.preventDefault();
        submitDraft();
      }}
    >
      <QueuedMessages />
      <ComposerContext />
      <div className="codex-input-surface">
        <AttachedContext />
        <textarea
          id="codexPrompt"
          ref={input}
          rows={1}
          maxLength={100000}
          aria-label={`Message ${agentName}`}
          aria-controls={menu.current ? 'codexComposerMenu' : undefined}
          aria-expanded={!!menu.current}
          aria-activedescendant={
            menu.current && menu.options.length ? `codex-command-${menu.active % menu.options.length}` : undefined
          }
          value={prompt}
          spellCheck={true}
          disabled={!writable}
          placeholder={
            !project
              ? 'Open a project to start a chat'
              : !signed
                ? `Sign in to message ${agentName}`
                : `Message ${agentName}…`
          }
          onChange={e => {
            setFollowUpTurn(null);
            codex.setPrompt(e.target.value);
          }}
          onPaste={e => {
            const image = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
            if (image) {
              e.preventDefault();
              void codex.pasteImageFile(image);
            }
          }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
              e.preventDefault();
              void codex.chooseAttachments();
              return;
            }
            if (menu.keyDown(e)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (isRunning && (e.metaKey || e.ctrlKey)) codex.steer();
              else submitDraft();
            }
          }}
        />
        <div className="codex-submit-actions">
          <button
            id="codexSend"
            type="submit"
            className="codex-send"
            aria-label={isRunning ? 'Follow-up options' : 'Send message'}
            title={isRunning ? 'Follow-up options · Enter' : 'Send · Enter'}
            aria-expanded={isRunning ? choosing : undefined}
            aria-controls={isRunning ? 'codexFollowUp' : undefined}
            hidden={isRunning && !hasDraft}
            disabled={busy || !writable || !hasDraft}
          >
            <Icon name="arrowUp" />
          </button>
          <button
            id="codexStop"
            type="button"
            className="codex-send codex-stop"
            aria-label="Stop"
            hidden={!isRunning}
            disabled={stopping || !turnId}
            title={turnId ? 'Stop this turn' : 'Waiting for the turn to start'}
            onClick={codex.stop}
          >
            <Icon name="stop" />
          </button>
        </div>
      </div>
      {choosing && (
        <div id="codexFollowUp" className="codex-follow-up" role="group" aria-label="Send follow-up">
          <span>Send follow-up</span>
          <button
            id="codexSteer"
            type="button"
            disabled={busy || !writable || !turnId}
            title="Guide the current turn · ⌘/Ctrl + Enter"
            onClick={() => {
              setFollowUpTurn(null);
              codex.steer();
            }}
          >
            Steer
          </button>
          <button
            id="codexQueue"
            type="button"
            disabled={busy || !writable}
            title="Send after the current turn"
            onClick={() => {
              setFollowUpTurn(null);
              codex.send();
            }}
          >
            Queue
          </button>
          <button
            type="button"
            className="codex-icon-button"
            aria-label="Cancel follow-up options"
            title="Keep editing · Escape"
            onClick={dismissChoices}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="codex-composer-actions">
        <ComposerTools controls={menu} disabled={!writable || busy} />
        <ModelOptions />
      </div>
    </form>
  );
}

function ModelOptions() {
  const provider = useChat(c => c.provider);
  const mode = useChat(c => c.collaborationMode);
  const models = useChat(c => c.codex.models);
  const model = useChat(c => c.model);
  const effort = useChat(c => c.effort);
  const permission = useChat(c => c.permission);
  const permissionDisabled = useChat(c => c.busy || !signedIn(c));
  const disabled = useChat(c => c.busy || running(c) || !signedIn(c));
  const efforts = models?.find(m => modelId(m) === model)?.supportedReasoningEfforts || [];
  return (
    <div className="codex-model-options">
      {provider === 'codex' && (
        <select
          id="codexMode"
          aria-label="Collaboration mode"
          value={mode}
          disabled={disabled}
          title="Plan explores and asks questions before proposing changes"
          onChange={e => codex.setCollaborationMode(e.target.value as 'default' | 'plan')}
        >
          <option value="default">Work</option>
          <option value="plan">Plan</option>
        </select>
      )}
      <label className="codex-icon-select codex-permission" title={`Permissions: ${permissionNames[permission]}`}>
        <Icon name={permission === 'read-only' ? 'lock' : permission === 'full-access' ? 'unlock' : 'shield'} />
        <select
          id="codexPermission"
          aria-label="Permission level"
          value={permission}
          disabled={permissionDisabled}
          title={`Permissions: ${permissionNames[permission]}. Applies to the next sent or queued message.`}
          onChange={e => codex.setPermission(e.target.value as codex.PermissionLevel)}
        >
          <option value="read-only">Read only</option>
          <option value="workspace-write">Workspace</option>
          <option value="full-access">Full access</option>
        </select>
      </label>
      <button
        type="button"
        className="codex-icon-button codex-model-refresh"
        title="Refresh available models"
        aria-label="Refresh available models"
        onClick={codex.retry}
        disabled={disabled}
      >
        <Icon name="refresh" />
      </button>
      <select
        id="codexModel"
        aria-label="Model"
        value={model}
        disabled={disabled}
        onChange={e => codex.setModel(e.target.value)}
      >
        {models?.length ? (
          models.map(m => (
            <option key={modelId(m)} value={modelId(m)}>
              {m.displayName || modelId(m)}
            </option>
          ))
        ) : (
          <option value="">Default model</option>
        )}
      </select>
      <label className="codex-icon-select" hidden={!efforts.length} title={`Reasoning effort: ${effort}`}>
        <Icon name="thought" />
        <select
          id="codexEffort"
          aria-label="Reasoning effort"
          title={`Reasoning effort: ${effort}`}
          value={effort}
          hidden={!efforts.length}
          disabled={disabled}
          onChange={e => codex.setEffort(e.target.value)}
        >
          {efforts.map(e => {
            const value = effortValue(e);
            return (
              <option key={value} value={value} title={typeof e === 'string' ? undefined : e.description}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
}

// The API projects.js uses: it creates the panel once, then switches projects and reports errors into it.
let mounted = false;
export const CodexChat = {
  init({ panel, ...options }: codex.ChatOptions & { panel: HTMLElement }) {
    if (mounted) return;
    mounted = true;
    panel.classList.add('codex-enabled');
    panel.setAttribute('aria-label', 'Codex chats');
    const root = document.createElement('section');
    root.className = 'codex-chat';
    root.id = 'codexChat';
    panel.append(root);
    flushSync(() => createRoot(root).render(<ChatPanel />));
    codex.startChat(options);
  },
  switchProject: codex.switchProject,
  refresh: codex.refresh,
  focus: codex.focusPrompt,
  reportError: codex.reportError,
  dispose: codex.stopChat,
};
