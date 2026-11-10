// Runs a socket-based adapter script in this process and ends it when Galaxy dies. Galaxy holds this process's
// stdin pipe; the pipe closes when Galaxy exits for any reason, including a crash or SIGKILL that skips cleanup.
// Usage: node parent-guard.cjs <adapter script> [args...]
const path = require('node:path');
const end = () => {
  // spawnOwned makes this process a group leader on POSIX, so the group also holds anything the adapter launched.
  try {
    if (process.platform !== 'win32') process.kill(-process.pid, 'SIGTERM');
  } catch {}
  process.exit(0);
};
process.stdin.on('end', end).on('close', end).on('error', end).resume();
process.argv.splice(1, 1);
require(path.resolve(process.argv[1]));
