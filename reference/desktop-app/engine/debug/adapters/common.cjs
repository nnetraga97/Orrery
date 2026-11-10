const { spawn } = require('node:child_process');
const net = require('node:net');
const { DapClient } = require('../dap/client.cjs');
// Galaxy's own secrets and switches never reach project code, directly or through launch variables.
// Windows environment names are case-insensitive, so compare them uppercased.
const privateEnv = key => {
  const name = key.toUpperCase();
  return name === 'NEBIUS_API_KEY' || name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('GALAXY_');
};
function scrubEnv(overrides = {}, inherited = process.env) {
  const env = { ...inherited, ...overrides };
  for (const key of Object.keys(env)) if (privateEnv(key) || env[key] == null) delete env[key];
  return env;
}
function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
  child.on('error', () => {});
  return child;
}
async function killProcess(child, { group = true } = {}) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const task = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      task.on('error', resolve);
      task.on('close', resolve);
    });
    return;
  }
  let target = group ? -child.pid : child.pid;
  if (group === 'auto') {
    try {
      process.kill(-child.pid, 0);
    } catch {
      target = child.pid;
    }
  }
  const exists = pid => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const gone = async () => {
    const until = Date.now() + 1500;
    while (exists(target) || exists(child.pid)) {
      if (Date.now() >= until) return false;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return true;
  };
  try {
    process.kill(target, 'SIGTERM');
  } catch {}
  if (await gone()) return;
  // A group may outlive its leader; the leader may also await reaping after its group exits.
  try {
    process.kill(target, 'SIGKILL');
  } catch {}
  await gone();
}
async function connect(port) {
  const socket = net.connect({ host: '127.0.0.1', port });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('DAP connect timed out'));
    }, 10000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return new DapClient(socket);
}
function filters(mode, advertised, policies) {
  const available = new Set((advertised || []).map(item => item.filter));
  return (policies[mode] || policies.failures).filter(id => available.has(id));
}
module.exports = { privateEnv, scrubEnv, spawnOwned, killProcess, connect, filters };
