// Monaco is the editor from VS Code, with local workers (no CDN or remote code).
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
// The embedded editor has no TS project service. Syntax diagnostics work; imports require a future workspace service.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
monaco.editor.defineTheme('galaxy-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1c1c1e',
    'editorGutter.background': '#1c1c1e',
    'editor.foreground': '#f2f2f7',
    'editorLineNumber.foreground': '#8e8e93',
    'editor.lineHighlightBorder': '#363638',
    'editor.selectionBackground': '#325474',
    focusBorder: '#64a9ff',
  },
});
export { monaco };
