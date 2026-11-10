// For structured tools/runners: publish evidence directly, never infer a result from shell text.
const { randomUUID } = require('node:crypto');
function startJob(emitter, description, fields = {}) {
  const operationId = fields.operationId || randomUUID(),
    startedAt = Date.now();
  let done = false;
  emitter.send('operation.started', { ...description, startedAt, evidence: 'structured' }, { ...fields, operationId });
  return {
    operationId,
    update(data) {
      if (!done) emitter.send('operation.updated', data, { ...fields, operationId });
    },
    finish(ok, result = {}) {
      if (done) return;
      done = true;
      emitter.send('operation.finished', { ...result, ok, finishedAt: Date.now() }, { ...fields, operationId });
    },
  };
}
module.exports = { startJob };
