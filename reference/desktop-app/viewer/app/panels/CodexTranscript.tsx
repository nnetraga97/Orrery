// The conversation (messages, the agent's grouped actions, its live status) and pending requests. Provider content is
// rendered as text through a deliberately small Markdown subset (Markdown.tsx): no provider-supplied HTML or links.
import { memo, useEffect, useState, type SubmitEvent } from 'react';
import { ChatImages } from './ChatImages.tsx';
import { Markdown } from './Markdown.tsx';
import { Icon } from './Icon.tsx';
import {
  reportError,
  respond,
  reuseMessage,
  copyMessage,
  type CodexItem,
  type CodexRequest,
  type CodexThread,
} from '../codex-chat.ts';
import {
  ActionGroup,
  ChangeDiff,
  PlanCard,
  TurnChanges,
  WorkingLine,
  isAction,
  textOf,
  track,
} from './CodexActions.tsx';

function MessageActions({ text, user }: { text: string; user: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!text) return null;
  return (
    <div className="codex-message-actions" role="group" aria-label="Message actions">
      <button
        type="button"
        title="Copy message"
        onClick={() => {
          void copyMessage(text)
            .then(() => setCopied(true))
            .catch(() => reportError('Could not copy this message.'));
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        title={
          user ? 'Reuse this text in a new draft; keeps the original message' : 'Quote this response in your draft'
        }
        onClick={() => reuseMessage(text, !user)}
      >
        {user ? 'Reuse' : 'Reply'}
      </button>
    </div>
  );
}
function MessageView({ item, threadId }: { item: CodexItem; threadId: string }) {
  const text = textOf(item);
  if (item.role === 'user' || item.type === 'userMessage')
    return (
      <article className="codex-message codex-user" aria-label="You">
        {!!item.attachmentNames?.length && (
          <div className="codex-user-attachments">
            {item.attachmentNames.map((name, i) => (
              <span key={`${i}:${name}`}>
                <Icon name="paperclip" />
                {name}
              </span>
            ))}
          </div>
        )}
        <div className="codex-user-text">{text}</div>
        <ChatImages item={item} threadId={threadId} />
        <MessageActions text={text} user />
      </article>
    );
  if (item.type === 'plan') return <PlanCard item={item} />;
  if (item.type === 'turnDiff') return <TurnChanges item={item} />;
  return (
    <article className="codex-message codex-assistant" aria-label="Codex">
      <Markdown text={text} />
      <ChatImages item={item} threadId={threadId} />
      <MessageActions text={text} user={false} />
    </article>
  );
}
// IPC clones item objects. Revisions skip unchanged content without reading the whole transcript.
const same = (a: CodexItem, b: CodexItem) =>
  a === b || (!!a.id && a.id === b.id && a.revision != null && a.revision === b.revision);
const Message = memo(MessageView, (a, b) => a.threadId === b.threadId && same(a.item, b.item));
const Group = memo(
  ActionGroup,
  (a, b) =>
    a.live === b.live && a.items.length === b.items.length && a.items.every((item, i) => same(item, b.items[i])),
);

type Entry = { key: string; message: CodexItem } | { key: string; actions: CodexItem[] };
// Messages stand alone; the actions between two of them form one group.
function arrange(items: CodexItem[]) {
  const out: Entry[] = [];
  let run: CodexItem[] | null = null;
  items.forEach((item, i) => {
    if (!isAction(item)) {
      run = null;
      out.push({ key: itemKey(item, i), message: item });
    } else if (run) run.push(item);
    else out.push({ key: itemKey(item, i), actions: (run = [item]) });
  });
  return out;
}

// The conversation: messages, grouped actions and, while the turn runs, what the agent is doing.
export function Conversation({ thread, live }: { thread: CodexThread; live: boolean }) {
  track(thread);
  const entries = arrange(thread.items || []);
  return (
    <>
      {entries.map((entry, i) =>
        'message' in entry ? (
          <Message key={entry.key} item={entry.message} threadId={thread.id} />
        ) : (
          <Group key={entry.key} items={entry.actions} live={live && i === entries.length - 1} />
        ),
      )}
      {live && !thread.requests?.length && <WorkingLine thread={thread} />}
    </>
  );
}

export function RequestCard({ request }: { request: CodexRequest }) {
  const [sending, setSending] = useState(false);
  const answer = async (response: unknown) => {
    setSending(true);
    if (!(await respond(request, response))) setSending(false);
  };
  const questions = request.questions || [];
  if (request.type === 'userInput' || request.type === 'questions') {
    const submit = (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget),
        answers: Record<string, { answers: string[] }> = {};
      questions.forEach((q, i) => {
        const id = q.id || String(i),
          custom = String(form.get(`custom:${id}`) ?? '').trim(),
          choice = form.get(`${request.id}:${id}`);
        if (custom) answers[id] = { answers: [custom] };
        else if (choice != null) answers[id] = { answers: [String(choice)] };
      });
      if (questions.some((q, i) => !answers[q.id || String(i)])) {
        reportError('Answer each question before sending.');
        return;
      }
      void answer({ answers });
    };
    return (
      <section className="codex-request" aria-label="Codex needs your input">
        <form onSubmit={submit}>
          <h3>A question for you</h3>
          {questions.map((q, index) => {
            const id = q.id || String(index),
              label = q.question || q.header || 'Your answer',
              options = q.options || [];
            return (
              <fieldset key={id}>
                <legend>{label}</legend>
                {options.map((option, i) => (
                  <label key={i} className="codex-answer-option">
                    <input
                      type="radio"
                      name={`${request.id}:${id}`}
                      value={option.label || option.value || String(i)}
                      disabled={sending}
                    />
                    <span>
                      <strong>{option.label || option.value}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                  </label>
                ))}
                {q.isSecret ? (
                  <input
                    type="password"
                    name={`custom:${id}`}
                    placeholder={options.length ? 'Or write your answer…' : 'Your answer…'}
                    aria-label={label}
                    disabled={sending}
                  />
                ) : (
                  <textarea
                    rows={2}
                    name={`custom:${id}`}
                    placeholder={options.length ? 'Or write your answer…' : 'Your answer…'}
                    aria-label={label}
                    disabled={sending}
                  />
                )}
              </fieldset>
            );
          })}
          <button type="submit" className="codex-primary" disabled={sending}>
            Send answer
          </button>
        </form>
      </section>
    );
  }
  return (
    <section className="codex-request" aria-label="Codex needs your input">
      <h3>{request.type === 'fileChangeApproval' ? 'Approve file changes' : 'Approve this action'}</h3>
      {request.reason && <p>{request.reason}</p>}
      {request.command && <pre className="codex-command">{request.command}</pre>}
      {request.cwd && <p className="codex-request-path">{request.cwd}</p>}
      {!!request.changes?.length && (
        <details>
          <summary>Review changes</summary>
          <ChangeDiff changes={request.changes} />
        </details>
      )}
      <div className="codex-request-actions">
        <button type="button" disabled={sending} onClick={() => answer({ decision: 'decline' })}>
          Decline
        </button>
        <button
          type="button"
          className="codex-primary"
          disabled={sending}
          onClick={() => answer({ decision: 'accept' })}
        >
          Approve once
        </button>
      </div>
    </section>
  );
}

export const itemKey = (item: CodexItem, index: number) => item.id || `${item.type}:${index}`;
