// Toolbar file search and ask-to-navigate atlas search.
import { useEffect, useRef, useState } from 'react';
import { search } from '../graph.ts';
import { G, actions } from '../state.ts';
import { buildAtlas, navigateAtlas, searchAtlas, useAtlas, type AtlasHit } from '../atlas.ts';
import type { FileNode } from '../types.ts';
import { useStore } from './use-store.ts';

export function FileSearch() {
  const color = useStore('color');
  const dataset = useStore('dataset');
  const disabled = useStore('emptyWorkspace');
  const atlas = useAtlas();
  const [query, setQuery] = useState('');
  const [ask, setAsk] = useState(false);
  const asking = ask || query.trimEnd().endsWith('?');
  const [hits, setHits] = useState<FileNode[]>([]);
  const [answers, setAnswers] = useState<AtlasHit[]>([]);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);

  useEffect(() => {
    setQuery('');
    setHits([]);
    setAnswers([]);
    setOpen(false);
    setMessage('');
    sequence.current++;
  }, [dataset]);
  useEffect(() => {
    sequence.current++;
    setAnswers([]);
    setMessage('');
    setActive(0);
  }, [query, asking]);
  useEffect(() => {
    const focusOnSlash = (e: KeyboardEvent) => {
      if (e.key !== '/' || document.activeElement === input.current) return;
      if (
        e.target instanceof Element &&
        e.target.closest('input, textarea, select, dialog, [role="textbox"], [contenteditable="true"]')
      )
        return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', focusOnSlash);
    return () => window.removeEventListener('keydown', focusOnSlash);
  }, []);

  const submit = async () => {
    if (!atlas?.built || !query.trim()) return;
    const ticket = ++sequence.current;
    setMessage('Searching…');
    setAnswers([]);
    setOpen(true);
    try {
      const found = await searchAtlas(dataset, query);
      if (ticket !== sequence.current) return;
      setAnswers(found.results);
      setActive(0);
      setMessage(
        !found.results.length
          ? 'No matching functions.'
          : found.reranked
            ? ''
            : 'Local matches · reranking unavailable.',
      );
    } catch (e) {
      if (ticket === sequence.current) setMessage((e as Error).message);
    }
  };
  const pickFile = (n?: FileNode) => {
    if (!n) return;
    setOpen(false);
    setQuery(n.name);
    input.current?.blur();
    actions.selectFile(n.i);
  };
  const pickAnswer = (hit?: AtlasHit) => {
    if (!hit) return;
    setOpen(false);
    input.current?.blur();
    navigateAtlas(hit);
  };
  const count = asking ? answers.length : hits.length;
  return (
    <>
      <svg viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <input
        id="q"
        ref={input}
        type="search"
        placeholder={asking ? 'Ask about the code… (Enter)' : 'Search files…  ( / )'}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={e => {
          setQuery(e.target.value);
          setHits(search(e.target.value));
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(count - 1, active + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(0, active - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (asking) {
              if (answers.length) pickAnswer(answers[active]);
              else void submit();
            } else pickFile(hits[active]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            sequence.current++;
            setOpen(false);
            input.current?.blur();
          }
        }}
        onBlur={() =>
          setTimeout(() => {
            if (document.activeElement !== input.current) setOpen(false);
          }, 100)
        }
      />
      <button
        className="atlas-ask-toggle"
        aria-pressed={asking}
        title="Ask the atlas"
        disabled={disabled}
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          setAsk(!asking);
          if (asking && query.trimEnd().endsWith('?')) setQuery(query.trimEnd().slice(0, -1));
          setOpen(true);
          input.current?.focus();
        }}
      >
        Ask
      </button>
      <div id="results" style={{ display: open && (asking || hits.length) ? 'block' : 'none' }}>
        {asking ? (
          <>
            {!atlas?.built ? (
              <section className="atlas-search-message">
                Build the atlas first.{' '}
                <button
                  disabled={!atlas || atlas.building}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => void buildAtlas().catch(e => setMessage(e.message))}
                >
                  {atlas?.building ? 'Building…' : 'Build atlas'}
                </button>
              </section>
            ) : (
              !answers.length &&
              !message && <section className="atlas-search-message">Press Enter to search the atlas.</section>
            )}
            {message && (
              <section className="atlas-search-message" role="status">
                {message}
              </section>
            )}
            {answers.map((hit, k) => (
              <div
                key={hit.id}
                className={`atlas-hit ${k === active ? 'act' : ''}`}
                onMouseDown={e => {
                  e.preventDefault();
                  pickAnswer(hit);
                }}
              >
                <b>{hit.name}</b>
                <span>
                  {hit.file}:{hit.line}
                </span>
                <p>{hit.summary}</p>
                <small>{hit.reason}</small>
              </div>
            ))}
          </>
        ) : (
          hits.map((n, k) => (
            <div
              key={n.i}
              className={k === active ? 'act' : ''}
              onMouseDown={e => {
                e.preventDefault();
                pickFile(n);
              }}
            >
              <i style={{ background: color(G(n)) }} />
              <b>{n.name}</b>
              <span>{n.path}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
