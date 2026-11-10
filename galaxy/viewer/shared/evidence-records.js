import { EVIDENCE } from '../../source-model/debug-records.js';

// One family per evidence type: what it looks like, and where it sits (above the building, or on its ground).
export const FAMILIES = Object.freeze({
  [EVIDENCE.exception]: { label: 'Exception', color: '#ff5a4f', above: true },
  [EVIDENCE.execution]: { label: 'Current position', color: '#ffc94d', above: true },
  [EVIDENCE.breakpoint]: { label: 'Breakpoint', color: '#ff8077', above: true },
  [EVIDENCE.testFailure]: { label: 'Failing test', color: '#e36bff', above: true },
  [EVIDENCE.log]: { label: 'Log', color: '#9fd3ff', above: true },
  [EVIDENCE.hotPath]: { label: 'Hot path', color: '#ff9a3c', above: true },
  [EVIDENCE.coverage]: { label: 'Coverage', color: '#6fd38a', above: false },
  [EVIDENCE.gitChange]: { label: 'Git change', color: '#ffd166', above: false },
});
const TRACE_COLOR = '#8bcfff',
  UNCOVERED_COLOR = '#8a8f99',
  CHANGE_COLORS = { added: '#7fdc7f', modified: '#ffd166', removed: '#ff8a7a' };

export function colorOf(record) {
  if (record.type === EVIDENCE.breakpoint && record.mode === 'trace') return TRACE_COLOR;
  if (record.type === EVIDENCE.coverage && !record.covered) return UNCOVERED_COLOR;
  if (record.type === EVIDENCE.gitChange) return CHANGE_COLORS[record.change] ?? CHANGE_COLORS.modified;
  return FAMILIES[record.type].color;
}
export function textOf(record) {
  const family = FAMILIES[record.type].label;
  if (record.type === EVIDENCE.exception) return record.message ? `${family}: ${record.message}` : family;
  if (record.type === EVIDENCE.testFailure) return `${family}: ${record.context ?? record.message ?? 'unnamed'}`;
  if (record.type === EVIDENCE.log) return record.message ? `${family}: ${record.message}` : family;
  if (record.type === EVIDENCE.hotPath) return `${family}: ${record.samples} samples`;
  if (record.type === EVIDENCE.coverage) return record.covered ? 'Covered' : 'Not covered';
  if (record.type === EVIDENCE.gitChange) return `Git: ${record.change ?? 'modified'}`;
  if (record.type === EVIDENCE.breakpoint)
    return `${record.mode === 'trace' ? 'Tracepoint' : family}${record.verified === false ? ' (pending)' : ''}`;
  return family;
}

