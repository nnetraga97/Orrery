// Shared by the live galaxy and the asset studio. Inputs are semantic work, never provider names.
const defaultSpeed = 0.75;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = n => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};
const count = n => (Number.isFinite(n) ? Math.max(0, n) : 0);
function profile(event = {}) {
  const created =
    event.created ||
    event.action === 'create' ||
    event.kind === 'entity-created' ||
    ['siege', 'genesis'].includes(event.ammo);
  const editing =
    created || event.kind === 'file-change' || ['edit', 'delete'].includes(event.action) || event.ammo === 'shell';
  // An existing file's total size is not the size of an edit. Only use bytes for creations.
  const lines = Math.max(count(event.changed), count(event.added) + count(event.removed), count(event.operationLines));
  const files = Math.max(count(event.operationFiles), event.files?.length || 0, event.changes?.length || 0, 1);
  const extent = Math.max(lines, created ? count(event.bytes) / 65 : 0);
  const magnitude = clamp(Math.log2(1 + extent / 8) / 8);
  const breadth = clamp(Math.log2(files) / 5);
  let power = editing
    ? Math.max(0.22 + 0.78 * magnitude, 0.22 + 0.78 * breadth)
    : { tracer: 0.16, flak: 0.3, mortar: 0.45, beam: 0.4, station: 0.24 }[event.ammo] || 0.22;
  if (created) power = Math.max(power, event.entity === 'directory' ? 0.64 : 0.74);
  power = clamp(power, 0.12, 1);
  const charge = 0.18 + 0.9 * power ** 1.25,
    hold = 0.035 + 0.1 * power,
    recovery = 0.36 + 0.52 * power;
  return {
    power,
    lines,
    files,
    charge,
    hold,
    fireAt: charge + hold,
    recovery,
    duration: charge + hold + recovery,
    recoil: 0.08 + 0.48 * power ** 1.4,
    label: power >= 0.9 ? 'Maximum' : power >= 0.64 ? 'High' : power >= 0.4 ? 'Medium' : 'Low',
  };
}
// Analytic poses: identical at 30/60/144 Hz, seekable, no accumulating spring drift.
function sample(p, time) {
  const t = Math.max(0, time),
    shot = t - p.fireAt,
    done = t >= p.duration;
  const charging = t < p.charge,
    armed = shot < 0;
  const fill = armed ? p.power * smooth(t / p.charge) : p.power * (1 - smooth(shot / 0.16));
  const preload = armed ? smooth((t / p.charge - 0.62) / 0.38) * p.power : 0;
  let kick = 0;
  if (!armed && !done) {
    if (shot < 0.045) kick = 1 - (1 - shot / 0.045) ** 3;
    else if (shot < 0.085) kick = 1;
    else {
      const k = clamp((shot - 0.085) / (p.recovery - 0.085));
      kick = (1 - smooth(k)) * Math.exp(-k * 2.2) - 0.055 * Math.sin(k * Math.PI * 2) * Math.sin(k * Math.PI);
    }
  }
  const flash = shot >= 0 && shot < 0.14 ? (1 - shot / 0.14) ** 2 : 0;
  return {
    phase: done ? 'idle' : charging ? 'charging' : armed ? 'braced' : shot < 0.14 ? 'firing' : 'recovering',
    power: p.power,
    fill: done ? 0 : fill,
    recoil: done ? 0 : kick * p.recoil + preload * 0.025,
    pitchOffset: done ? 0 : kick * (0.01 + p.power * 0.045) - preload * 0.015,
    compression: done ? 0 : kick * (0.004 + p.power * 0.012),
    flash,
    blast: shot >= 0 && shot < 0.32 ? shot / 0.32 : -1,
    done,
  };
}
const presets = {
  small: { kind: 'file-change', ammo: 'shell', added: 2, removed: 1, files: ['example.ts'] },
  create: { kind: 'file-change', ammo: 'siege', created: true, added: 80, files: ['new-module.ts'] },
  large: { kind: 'file-change', ammo: 'shell', added: 320, removed: 180, files: ['example.ts'] },
  huge: { kind: 'file-change', ammo: 'shell', added: 1800, removed: 900, operationFiles: 24, files: ['example.ts'] },
};
export const CannonMotion = { profile, sample, presets, defaultSpeed };
