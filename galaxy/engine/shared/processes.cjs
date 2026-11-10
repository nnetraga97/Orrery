// Child-process shutdown shared by analyzers, provider CLIs and the Codex app-server.
const escalating = new WeakSet();

const hasExited = child => child.exitCode !== null || child.signalCode !== null;

function sendSignal(child, signal, group) {
  // Windows has no process groups or signals; end the whole tree so a cmd.exe wrapper
  // cannot leave its child running.
  if (process.platform === 'win32' && child.pid) {
    try {
      require('node:child_process')
        .spawn('taskkill', ['/pid', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], {
          windowsHide: true,
          stdio: 'ignore',
        })
        .on('error', () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  try {
    if (group && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    // ESRCH: already gone. EPERM: macOS reports it for a group whose leader exited but is not yet reaped.
    if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
  }
}

// SIGTERM now and SIGKILL after graceMs if the process is still running. Safe to call repeatedly.
// `group` signals the whole process group; the child must have been spawned with `detached: true` (POSIX).
function terminate(child, { group = false, graceMs = 2000 } = {}) {
  if (hasExited(child)) return;
  sendSignal(child, 'SIGTERM', group);
  if (escalating.has(child)) return;
  escalating.add(child);
  const timer = setTimeout(() => {
    if (!hasExited(child)) sendSignal(child, 'SIGKILL', group);
  }, graceMs);
  timer.unref();
  child.once('exit', () => clearTimeout(timer));
}

module.exports = { terminate };
