// Wraps the agent port to keep each request's token usage (window.__orrery.usage, and a console line per request, so
// prompt caching can be checked in the browser) and, with ?record=1, to record the run in the recorded-session format.
// The recording is printed to the console after every reply, ready to save as src/adapters/fake-sessions/<id>.json,
// and is also at window.__orrery.recording.session(note).
import { createRecording } from '../core/agent/recording.ts';
import type { Recording } from '../core/agent/recording.ts';
import type { AgentPort } from '../ports/agent.ts';

export function withRecording(port: AgentPort, { record, id }: { record: boolean; id: string }): { port: AgentPort; recording: Recording } {
  const recording = createRecording(id);
  return {
    recording,
    port: {
      get label() {
        return port.label;
      },
      send(request, onEvent, signal) {
        return port.send(request, event => {
          if (event.type === 'usage') {
            recording.usage(event.usage, Date.now());
            const u = event.usage;
            console.info(`[orrery] usage: input ${u.input}, cache read ${u.cacheRead ?? 0}, cache write ${u.cacheWrite ?? 0}, output ${u.output}`);
          }
          if (event.type === 'message' && record) {
            recording.reply(event.message, event.stopReason);
            console.info('[orrery] recording so far:\n' + JSON.stringify(recording.session('A live run, recorded with ?record=1.'), null, 2));
          }
          onEvent(event);
        }, signal);
      },
    },
  };
}
