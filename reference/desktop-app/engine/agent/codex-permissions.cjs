const levels = ['read-only', 'workspace-write', 'full-access'];
function permissionLevel(value = 'workspace-write') {
  if (!levels.includes(value)) throw new Error('Unsupported chat permission level.');
  return value;
}
function permissionPolicy(root, level) {
  level = permissionLevel(level);
  const sandbox = level === 'full-access' ? 'danger-full-access' : level;
  const approvalPolicy = level === 'workspace-write' ? 'on-request' : 'never';
  const sandboxPolicy =
    level === 'full-access'
      ? { type: 'dangerFullAccess' }
      : level === 'read-only'
        ? { type: 'readOnly', networkAccess: false }
        : {
            type: 'workspaceWrite',
            writableRoots: [root],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          };
  return { sandbox, sandboxPolicy, approvalPolicy };
}
module.exports = { permissionLevel, permissionPolicy };
