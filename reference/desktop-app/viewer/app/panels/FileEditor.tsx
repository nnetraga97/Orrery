import { agentShowStore } from '../agent-show.ts';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { debugStore, toggleBreakpoint } from '../debug.ts';
import { monaco } from '../monaco.ts';
import { editFile, filesStore, isDirty, reloadFile, saveFile } from '../workspace-files.ts';
import { Icon } from './Icon.tsx';
import { problemsStore } from '../problems.ts';
import { activeFolder, workbenchStore } from '../workbench.ts';
import { sourceNavigationStore, revealEditorSource } from '../source-navigation.ts';

type ModelState = {
  model: monaco.editor.ITextModel;
  view: monaco.editor.ICodeEditorViewState | null;
  change: monaco.IDisposable;
  syncing: boolean;
  text: string;
  version: number;
};
export default function FileEditor() {
  const agentShow = useSyncExternalStore(agentShowStore.subscribe, agentShowStore.get);
  const problems = useSyncExternalStore(problemsStore.subscribe, problemsStore.get);
  const activeProject = useSyncExternalStore(workbenchStore.subscribe, () => activeFolder()?.project.id);
  const debug = useSyncExternalStore(debugStore.subscribe, debugStore.get);
  const navigation = useSyncExternalStore(sourceNavigationStore.subscribe, sourceNavigationStore.get);
  const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
  const workspaceBusy = useSyncExternalStore(workbenchStore.subscribe, () => !!workbenchStore.get().busy);
  const doc = files.documents.find(d => d.id === files.active);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const revealedAgent = useRef<typeof agentShow.reveal>(null);
  const revealedSource = useRef<typeof navigation.reveal>(null);
  const models = useRef(new Map<string, ModelState>());
  const [position, setPosition] = useState({ lineNumber: 1, column: 1 });
  useLayoutEffect(() => {
    const instance = monaco.editor.create(host.current!, {
      model: null,
      glyphMargin: true,
      theme: 'galaxy-dark',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"SF Mono", SFMono-Regular, Menlo, monospace',
      lineHeight: 21,
      minimap: { enabled: false },
      padding: { top: 12 },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: false,
      tabSize: 2,
      accessibilitySupport: 'auto',
      ariaLabel: 'File editor',
    });
    editor.current = instance;
    const breakpoint = instance.onMouseDown(e => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return;
      const files = filesStore.get();
      const doc = files.documents.find(d => d.id === files.active);
      if (doc) void toggleBreakpoint(doc.path, e.target.position.lineNumber, 1, doc.text);
    });
    instance.addAction({
      id: 'galaxy.revealSource',
      label: 'Reveal Source in Landed World',
      contextMenuGroupId: 'navigation',
      run: () => {
        const files = filesStore.get(),
          doc = files.documents.find(d => d.id === files.active),
          at = instance.getPosition();
        if (doc && at)
          void revealEditorSource(
            { file: doc.path, text: doc.text, line: at.lineNumber, column: at.column },
            doc.projectId,
          );
      },
    });
    instance.addAction({
      id: 'galaxy.toggleBreakpoint',
      label: 'Toggle Breakpoint',
      keybindings: [monaco.KeyCode.F9],
      contextMenuGroupId: 'debug',
      run: () => {
        const files = filesStore.get(),
          doc = files.documents.find(d => d.id === files.active),
          at = instance.getPosition();
        if (doc && at) void toggleBreakpoint(doc.path, at.lineNumber, 1, doc.text);
      },
    });
    const cursor = instance.onDidChangeCursorPosition(e => setPosition(e.position));
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveFile());
    return () => {
      breakpoint.dispose();
      cursor.dispose();
      instance.dispose();
      editor.current = null;
      for (const entry of models.current.values()) {
        entry.change.dispose();
        entry.model.dispose();
      }
      models.current.clear();
    };
  }, []);
  useLayoutEffect(() => {
    editor.current?.updateOptions({ readOnly: workspaceBusy });
  }, [workspaceBusy]);
  useLayoutEffect(() => {
    const instance = editor.current!;
    if (!doc) {
      instance.setModel(null);
      return;
    }
    let entry = models.current.get(doc.id);
    if (!entry) {
      const uri = monaco.Uri.from({ scheme: 'file', path: `/${doc.projectId}/${doc.path}` });
      const model = monaco.editor.createModel(doc.text, undefined, uri);
      entry = {
        model,
        view: null,
        syncing: false,
        text: doc.text,
        version: model.getVersionId(),
        change: model.onDidChangeContent(() => {
          if (!entry || entry.syncing || entry.version === model.getVersionId()) return;
          entry.version = model.getVersionId();
          const text = model.getValue(undefined, true);
          if (entry.text === text) return;
          // Publish after updating the cache: the store echo must not rewrite the model.
          entry.text = text;
          editFile(doc.id, text);
        }),
      };
      models.current.set(doc.id, entry);
    }
    instance.setModel(entry.model);
    if (entry.view) instance.restoreViewState(entry.view);
    instance.updateOptions({ ariaLabel: `File editor: ${doc.path}` });
    instance.layout();
    instance.focus();
    return () => {
      entry.view = instance.saveViewState();
    };
  }, [doc?.id]);
  useLayoutEffect(() => {
    const documents = new Map(files.documents.map(d => [d.id, d]));
    for (const [id, entry] of models.current) {
      const current = documents.get(id);
      if (!current) {
        entry.change.dispose();
        entry.model.dispose();
        models.current.delete(id);
      }
      // Disk refreshes preserve undo history. Locally typed text is already in the model.
      else if (entry.text !== current.text) {
        entry.syncing = true;
        try {
          if (entry.text.startsWith('\uFEFF') !== current.text.startsWith('\uFEFF')) {
            entry.model.setValue(current.text);
          } else {
            entry.model.setEOL(
              current.text.includes('\r\n') ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
            );
            entry.model.pushEditOperations(
              [],
              [{ range: entry.model.getFullModelRange(), text: current.text.replace(/^\uFEFF/, '') }],
              () => null,
            );
          }
          entry.text = current.text;
          entry.version = entry.model.getVersionId();
        } finally {
          entry.syncing = false;
        }
      }
    }
  }, [files.documents]);
  useLayoutEffect(() => {
    const instance = editor.current;
    const target = debug.reveal;
    if (
      !instance ||
      !doc ||
      !target ||
      target.projectId !== doc.projectId ||
      target.frame.file !== doc.path ||
      target.frame.text !== doc.text
    )
      return;
    const { line, column } = target.frame;
    instance.setPosition({ lineNumber: line, column });
    instance.revealPositionInCenter({ lineNumber: line, column });
    const decorations = instance.createDecorationsCollection([
      {
        range: new monaco.Range(line, column, line, column + 1),
        options: {
          isWholeLine: true,
          className: 'debug-current-line',
          linesDecorationsClassName: 'debug-current-gutter',
        },
      },
    ]);
    return () => decorations.clear();
  }, [debug.reveal, doc?.id, doc?.text]);
  useLayoutEffect(() => {
    const target = agentShow.reveal;
    if (
      !doc ||
      !target ||
      target === revealedAgent.current ||
      target.projectId !== doc.projectId ||
      target.file !== doc.path ||
      !editor.current
    )
      return;
    revealedAgent.current = target;
    const line = Math.min(target.line ?? 1, editor.current.getModel()?.getLineCount() ?? 1);
    editor.current.setPosition({ lineNumber: line, column: 1 });
    editor.current.revealPositionInCenter({ lineNumber: line, column: 1 });
  }, [agentShow.reveal, doc?.id, doc?.text]);
  useLayoutEffect(() => {
    const target = navigation.reveal;
    if (
      !doc ||
      !target ||
      revealedSource.current === target ||
      navigation.projectId !== doc.projectId ||
      target.file !== doc.path ||
      target.text !== doc.text
    )
      return;
    revealedSource.current = target;
    editor.current?.setPosition({ lineNumber: target.line, column: target.column });
    editor.current?.revealPositionInCenter({ lineNumber: target.line, column: target.column });
  }, [navigation.reveal, doc?.id, doc?.text]);
  useLayoutEffect(() => {
    if (!editor.current || !doc || debug.runtime.projectId !== doc.projectId) return;
    const marks = editor.current.createDecorationsCollection(
      (debug.runtime.breakpoints || [])
        .filter(b => b.file === doc.path)
        .map(b => ({
          range: new monaco.Range(b.line, b.column, b.line, b.column),
          options: {
            glyphMarginClassName:
              b.text !== doc.text
                ? 'debug-breakpoint-stale'
                : b.mode === 'trace'
                  ? 'debug-tracepoint'
                  : b.status === 'verified'
                    ? 'debug-breakpoint'
                    : 'debug-breakpoint-pending',
            glyphMarginHoverMessage: {
              value: `${b.mode === 'trace' ? 'Tracepoint' : 'Breakpoint'} · ${b.text !== doc.text ? 'stale source' : b.status || 'pending'}`,
            },
          },
        })),
    );
    return () => marks.clear();
  }, [debug.runtime.breakpoints, debug.runtime.projectId, doc?.id, doc?.text]);
  useLayoutEffect(() => {
    const severity = {
      error: monaco.MarkerSeverity.Error,
      warning: monaco.MarkerSeverity.Warning,
      info: monaco.MarkerSeverity.Info,
      hint: monaco.MarkerSeverity.Hint,
    };
    for (const [id, entry] of models.current) {
      const document = files.documents.find(d => d.id === id);
      const diagnostics =
        document && document.projectId === activeProject && problems.projectId === activeProject
          ? problems.diagnostics.filter(d => d.file === document.path)
          : [];
      monaco.editor.setModelMarkers(
        entry.model,
        'galaxy-problems',
        diagnostics.map(d => ({
          startLineNumber: d.line,
          startColumn: d.column,
          endLineNumber: d.endLine,
          endColumn: d.endColumn,
          severity: severity[d.severity],
          message: d.message,
          source: d.source,
          code: d.code,
        })),
      );
    }
  }, [problems.diagnostics, problems.projectId, files.documents, doc?.id, activeProject]);
  useLayoutEffect(() => {
    const target = problems.reveal;
    if (!target || !doc || target.projectId !== doc.projectId || target.file !== doc.path) return;
    editor.current?.setPosition({ lineNumber: target.line, column: target.column });
    editor.current?.revealPositionInCenter({ lineNumber: target.line, column: target.column });
    editor.current?.focus();
  }, [problems.reveal, doc?.id]);
  const activeModel = doc && models.current.get(doc.id);
  const eol =
    activeModel && activeModel.text === doc?.text
      ? activeModel.model.getEOL()
      : doc?.text.includes('\r\n')
        ? '\r\n'
        : '\n';
  return (
    <section id="wbFileEditor" hidden={!doc} aria-label="File editor area">
      <div className="wb-breadcrumbs">
        <span title={doc?.path}>{doc?.path.split('/').join('  ›  ')}</span>
        <button title="Reload from Disk" aria-label="Reload from Disk" onClick={() => doc && void reloadFile(doc.id)}>
          <Icon name="refresh" />
        </button>
        <button
          id="wbSaveFile"
          disabled={!doc || !isDirty(doc) || doc.saving}
          title="Save (⌘/Ctrl S)"
          aria-label="Save File"
          onClick={() => void saveFile()}
        >
          <Icon name="save" />
        </button>
      </div>
      {navigation.message && navigation.projectId === doc?.projectId && navigation.file === doc?.path && (
        <div className="wb-source-navigation" role="status">
          {navigation.reveal?.file === doc.path && navigation.reveal.text !== doc.text
            ? 'Source changed since navigation. Reveal requires the mapped revision.'
            : navigation.message}
        </div>
      )}
      {doc?.error && (
        <div className="wb-file-error" role="alert">
          {doc.error}
        </div>
      )}
      <div className="wb-monaco" ref={host} />
      <div className="wb-editor-status">
        <span>{doc?.saving ? 'Saving…' : doc && isDirty(doc) ? 'Unsaved changes' : 'Saved'}</span>
        <span>
          Ln {position.lineNumber}, Col {position.column}
        </span>
        <span>UTF-8</span>
        <span>{eol === '\r\n' ? 'CRLF' : 'LF'}</span>
      </div>
    </section>
  );
}
