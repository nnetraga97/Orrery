// Inject native owners so the active-project boundary can be checked offline.
function createAgentShow({ workspaceState, preferences, getWindow }) {
  return async (projectId, { file, line, message, provider = 'nemotron' }) => {
    if (!['nemotron', 'codex', 'claude'].includes(provider)) throw new Error('Unknown agent provider.');
    const prefs = await preferences();
    const { current } = await workspaceState();
    if (!projectId || current?.activeProjectId !== projectId)
      throw new Error('Cannot show a location: this project is not the active workspace project.');
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error('Cannot show a location: the window is unavailable.');
    window.webContents.send('galaxy:agent-show', {
      projectId,
      file,
      line,
      message,
      provider,
      time: Date.now(),
    });
    return { following: prefs.galaxyFollow === 'on' };
  };
}
module.exports = { createAgentShow };
