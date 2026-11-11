// Which tool calls run directly, which wait for the user's approval, and which are refused, by permission level and
// mode. Only the two edit tools ever change anything; every other tool reads, points or asks.
import type { Mode, Permission } from '../chat/composer.ts';

export const EDIT_TOOLS = ['replace_in_file', 'write_file'];
export const PLAN_MODE_REFUSAL = 'Plan mode: no edits.';
export const READ_ONLY_REFUSAL = 'Read only: no edits. Ask the user to allow edits.';

export type Decision = { run: 'direct' } | { run: 'approve' } | { run: 'refuse'; reason: string };

export function needsApproval(tool: string, permission: Permission, mode: Mode = 'work'): Decision {
  if (!EDIT_TOOLS.includes(tool)) return { run: 'direct' };
  if (mode === 'plan') return { run: 'refuse', reason: PLAN_MODE_REFUSAL };
  if (permission === 'readOnly') return { run: 'refuse', reason: READ_ONLY_REFUSAL };
  return permission === 'full' ? { run: 'direct' } : { run: 'approve' };
}
