// How the Run and Debug panel shows a paused frame: IDE-style frame labels, the frame's signature with its argument
// values, kind-tagged variables and a one-line evaluator.
import { useEffect, useState } from 'react';
import { evaluateDebug, inspectVariable, type DebugFrame, type Variable, type VariableKind } from '../debug.ts';
import { frameParts } from '../../shared/debug-frames.js';

export { frameParts };

const BADGE: Record<VariableKind, [string, string]> = {
  parameter: ['p', 'Parameter'],
  local: ['≡', 'Local variable'],
  receiver: ['t', 'This object'],
  field: ['f', 'Field'],
  index: ['', 'Element'],
  scope: ['', 'Scope'],
};
// Objects read as {Type@id}, as in IntelliJ; primitives show their type after the value.
const shown = (v: Variable) =>
  v.handle && v.kind !== 'scope' && v.type !== 'lambda' && !/^[{[]/.test(v.display) ? `{${v.display}}` : v.display;
const typeAfter = (v: Variable) =>
  !v.handle && v.type && v.type !== v.display && !v.display.includes(v.type) ? v.type : '';

export function VariableNode({ value, depth = 0 }: { value: Variable; depth?: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Variable[] | null>(null);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [resolved, setResolved] = useState<Variable | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (open && value.handle && !children)
      void inspectVariable(value.handle)
        .then(async result => {
          // A lazy value (java-debug's toString) expands to one unnamed child: the value itself.
          const only = result.values.length === 1 && !result.values[0].name ? result.values[0] : null;
          if (only) {
            if (!cancelled) setResolved(only);
            result = only.handle ? await inspectVariable(only.handle) : { values: [], truncated: false };
          }
          if (!cancelled) {
            setChildren(result.values);
            setTruncated(result.truncated);
          }
        })
        .catch(e => {
          if (!cancelled) setError(String(e));
        });
    return () => {
      cancelled = true;
    };
  }, [open, value.handle, children]);
  const [letter, title] = BADGE[value.kind || 'local'];
  const type = typeAfter(value);
  return (
    <li className="dbg-variable" role="treeitem" aria-expanded={value.handle ? open : undefined}>
      <button
        disabled={!value.handle}
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: 6 + depth * 16 }}
        title={value.type ? `${title} · ${value.type}` : title}
      >
        <span className="dbg-twisty" aria-hidden="true">
          {value.handle ? (open ? '▾' : '▸') : ''}
        </span>
        {letter ? (
          <span className={`dbg-kind dbg-kind-${value.kind}`} aria-label={title}>
            {letter}
          </span>
        ) : (
          <span className="dbg-kind dbg-kind-none" aria-hidden="true" />
        )}
        <span className="dbg-name">{value.name}</span>
        {value.kind !== 'scope' && <span className="dbg-equals">=</span>}
        <code className={value.handle ? 'dbg-object' : 'dbg-value'}>{shown(value)}</code>
        {resolved && resolved.display !== value.display && (
          <code className="dbg-value">{resolved.display.replace(value.display, '').trim()}</code>
        )}
        {type && <small className="dbg-type">{type}</small>}
      </button>
      {open && error && <p role="alert">{error}</p>}
      {open && children && (
        <ul role="group">
          {children.map((v, i) => (
            <VariableNode key={`${i}:${v.name}`} value={v} depth={depth + 1} />
          ))}
          {truncated && <li className="dbg-more">First 200 shown</li>}
        </ul>
      )}
    </li>
  );
}

export function Signature({ frame, variables }: { frame: DebugFrame; variables: Variable[] }) {
  const { method, owner } = frameParts(frame);
  const params = variables.filter(v => v.kind === 'parameter');
  return (
    <div className="dbg-signature" title={`${frame.file}:${frame.line}`}>
      <span className="dbg-owner">{owner}.</span>
      <strong>{method}</strong>(
      {params.map((p, i) => (
        <span key={p.name}>
          {i > 0 && ', '}
          <span className="dbg-param">{p.name}</span> = <code>{shown(p)}</code>
        </span>
      ))}
      )<small> :{frame.line}</small>
    </div>
  );
}

export function EvaluateLine({ paused, frame }: { paused: boolean; frame?: string }) {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<{ expression: string; display: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setResult(null), [frame]);
  return (
    <form
      className="dbg-evaluate"
      aria-label="Evaluate expression"
      onSubmit={async e => {
        e.preventDefault();
        if (!paused || !frame || busy || !expression.trim()) return;
        setBusy(true);
        try {
          setResult({ expression, display: (await evaluateDebug(expression)).display, error: false });
        } catch (error) {
          setResult({ expression, display: String(error), error: true });
        }
        setBusy(false);
      }}
    >
      <input
        aria-label="Evaluate expression"
        placeholder={paused ? 'Evaluate expression (⏎)' : 'Pause to evaluate'}
        value={expression}
        disabled={!paused || !frame || busy}
        onChange={e => setExpression(e.target.value)}
      />
      {result && (
        <p className={result.error ? 'dbg-eval-error' : 'dbg-eval-result'} role={result.error ? 'alert' : 'status'}>
          <span>{result.expression}</span> = <code>{result.display}</code>
        </p>
      )}
    </form>
  );
}
