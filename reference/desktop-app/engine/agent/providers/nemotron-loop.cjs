const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createEmitter } = require('../protocol.cjs');
const { permissionLevel } = require('../codex-permissions.cjs');
const { clip, toolsFor, prepareTool, executeTool } = require('./nemotron-tools.cjs');
const { toolItem } = require('./nemotron-items.cjs');
const { galaxyGuidance } = require('../galaxy-tools.cjs');

const ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const SYSTEM =
  'You are a coding agent working in the project repository. Plan briefly and explore with tools. When the user asks for a change, make minimal correct edits, run the project tests or build to verify, and iterate until done. All tool paths must be relative to the project root. Respect the selected permissions. Finish with a short summary and no tool calls.';
function readKey(env = process.env, home = os.homedir()) {
  if (env.NEBIUS_API_KEY?.trim()) return env.NEBIUS_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(home, '.config/nebius/api_key'), 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error('Cannot read ~/.config/nebius/api_key.');
  }
}

function completionEndpoint(testEndpoint) {
  // Only the offline check injects a loopback endpoint and a fixture key. Environment cannot redirect credentials.
  let endpoint = ENDPOINT;
  if (testEndpoint) {
    const url = new URL(testEndpoint);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.username ||
      url.password ||
      url.pathname !== '/v1/chat/completions'
    )
      throw new Error('The test endpoint must be a loopback Chat Completions server.');
    endpoint = url.href;
  }
  return endpoint;
}

function createNemotronLoop({
  root,
  sessionId,
  messages = [],
  env = process.env,
  onEvent,
  onItem,
  onHistory = () => {},
  approve,
  testEndpoint,
}) {
  const endpoint = completionEndpoint(testEndpoint);
  const emitter = createEmitter({
    provider: 'nemotron',
    sessionId,
    workspaceRoot: root,
    displayName: 'Nemotron',
    emit: onEvent,
  });
  let started = false,
    running = false;
  return {
    async run({
      text,
      turnId,
      key,
      model = env.GALAXY_NEMOTRON_MODEL || DEFAULT_MODEL,
      permission = 'workspace-write',
      signal,
      semanticSearch,
      debug,
      show,
    }) {
      if (running) throw new Error('A Nemotron turn is already running.');
      permissionLevel(permission);
      if (!key) throw new Error('Provide a Nebius Token Factory API key.');
      running = true;
      const redact = value =>
        String(value ?? '')
          .split(key)
          .join('[REDACTED]');
      const clean = value => JSON.parse(JSON.stringify(value, (_name, v) => (typeof v === 'string' ? redact(v) : v)));
      const item = (value, status = 'completed') => onItem(clean(value), turnId, status);
      const send = (type, payload, fields) => emitter.send(type, clean(payload), fields);
      let outcome = 'completed',
        error = null;
      let promptTokens = 0,
        completionTokens = 0;
      try {
        if (!started) {
          emitter.start();
          started = true;
        }
        emitter.begin(clip(redact(text), 8000), turnId);
        const system = `${SYSTEM} ${galaxyGuidance({ debug, show, semanticSearch })}`;
        if (!messages.length) messages.push({ role: 'system', content: system });
        else if (messages[0].role === 'system') messages[0].content = system;
        // Complete tool results left pending by an app shutdown before resuming the history.
        const lastAssistant = messages.findLastIndex(m => m.role === 'assistant');
        for (const call of messages[lastAssistant]?.tool_calls || [])
          if (!messages.slice(lastAssistant + 1).some(m => m.role === 'tool' && m.tool_call_id === call.id))
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'Interrupted before this tool returned.' });
        messages.push({ role: 'user', content: redact(text) });
        onHistory();
        for (let callIndex = 0; callIndex < 40; callIndex++) {
          signal.throwIfAborted();
          let response;
          try {
            response = await fetch(endpoint, {
              method: 'POST',
              redirect: 'error',
              signal,
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body: JSON.stringify({
                model,
                messages,
                tools: toolsFor(permission, !!semanticSearch, !!debug, !!show),
                tool_choice: 'auto',
                temperature: 0.2,
                max_tokens: 4096,
                stream: false,
              }),
            });
          } catch (cause) {
            if (signal.aborted) throw signal.reason;
            throw new Error('Nebius Token Factory request failed. Check your connection and API key.');
          }
          if (!response.ok)
            throw new Error(`Nebius Token Factory returned HTTP ${response.status}. Check your key, model and quota.`);
          let data;
          try {
            data = clean(await response.json());
          } catch {
            signal.throwIfAborted();
            throw new Error('Nebius Token Factory returned invalid JSON.');
          }
          signal.throwIfAborted();
          const message = data.choices?.[0]?.message;
          if (
            !message ||
            (message.content != null && typeof message.content !== 'string') ||
            (message.tool_calls != null && !Array.isArray(message.tool_calls))
          )
            throw new Error('Nebius Token Factory returned an invalid assistant message.');
          promptTokens += Math.max(0, Number(data.usage?.prompt_tokens) || 0);
          completionTokens += Math.max(0, Number(data.usage?.completion_tokens) || 0);
          send('usage', { context: promptTokens + completionTokens, promptTokens, completionTokens });
          const calls = message.tool_calls || [];
          if (
            calls.some(
              call =>
                typeof call?.id !== 'string' ||
                typeof call.function?.name !== 'string' ||
                typeof call.function.arguments !== 'string',
            ) ||
            new Set(calls.map(c => c.id)).size !== calls.length
          )
            throw new Error('Nebius Token Factory returned invalid tool calls.');
          messages.push({
            role: 'assistant',
            content: message.content || null,
            ...(calls.length ? { tool_calls: calls } : {}),
          });
          onHistory();
          if (message.content) {
            item({ id: randomUUID(), type: 'agentMessage', text: message.content });
            send('message', { role: 'assistant', text: clip(message.content, 8000) });
          }
          if (!calls.length) {
            if (data.choices[0].finish_reason === 'length')
              throw new Error('Nemotron reached the response token limit before finishing.');
            return { outcome, usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } };
          }
          for (const call of calls) {
            const operationId = randomUUID(),
              name = call.function.name;
            let input = {},
              prepared = {
                action:
                  {
                    __proto__: null,
                    list_files: 'read',
                    read_file: 'read',
                    search: 'search',
                    semantic_search: 'search',
                    replace_in_file: 'edit',
                    write_file: 'edit',
                    run_command: 'command',
                  }[name] || 'other',
                files: [],
              },
              failure;
            try {
              input = JSON.parse(call.function.arguments);
              prepared = await prepareTool(root, name, input, permission, semanticSearch, signal, debug, show);
            } catch (cause) {
              failure = cause;
            }
            if (signal.aborted) {
              messages.push({ role: 'tool', tool_call_id: call.id, content: 'Interrupted before this tool ran.' });
              continue;
            }
            send(
              'operation.started',
              {
                action: prepared.action,
                files: prepared.files,
                tool: clip(name, 200),
                ...(name === 'run_command' && { command: clip(input?.command || '', 8000) }),
              },
              { operationId },
            );
            let result;
            if (!failure) item(toolItem(operationId, name, input, prepared), 'inProgress');
            try {
              if (failure) throw failure;
              result = await executeTool(name, input, prepared, {
                root,
                debug,
                show,
                env,
                signal,
                permission,
                approve: command => approve({ command, operationId, turnId, signal }),
              });
            } catch (cause) {
              result = {
                ok: false,
                denied: /read-only/.test(String(cause?.message || '')),
                output: signal.aborted ? 'The user stopped this turn.' : `Error: ${redact(cause?.message || cause)}`,
              };
            }
            result.output = clip(redact(result.output));
            messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
            item(
              failure
                ? {
                    id: operationId,
                    type: 'dynamicToolCall',
                    tool: clip(name, 200),
                    arguments: input,
                    result: result.output,
                  }
                : toolItem(operationId, name, input, prepared, result),
              result.ok ? 'completed' : result.denied || signal.aborted ? 'declined' : 'failed',
            );
            send(
              'operation.finished',
              {
                ok: result.ok,
                ...(result.denied ? { denied: true } : {}),
                ...(result.ok ? {} : { error: result.output }),
              },
              { operationId },
            );
            onHistory();
          }
        }
        signal.throwIfAborted();
        throw new Error('Nemotron reached the limit of 40 model calls for this turn.');
      } catch (cause) {
        outcome = signal.aborted ? 'interrupted' : 'failed';
        error = signal.aborted ? null : redact(cause?.message || cause);
        if (error) {
          item({ id: randomUUID(), type: 'error', text: error });
          send('message', { role: 'error', text: clip(error, 8000) });
        }
        return { outcome, error, usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } };
      } finally {
        try {
          onHistory();
        } finally {
          running = false;
          send('turn.finished', { outcome });
        }
      }
    },
  };
}
module.exports = { createNemotronLoop, readKey, DEFAULT_MODEL, completionEndpoint };
