import { useState } from 'react';
import { adapterDetails, settingsBridge, type AdapterStatus } from '../settings.ts';
export function AdapterReadiness({
  adapter,
  refresh,
  compact = false,
}: {
  adapter: AdapterStatus;
  refresh: () => Promise<void>;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const detail = adapterDetails[adapter.id];
  return (
    <div className="adapter-readiness">
      {!adapter.installed ? (
        <>
          <p>
            {detail.label} debugging needs {adapter.id} {detail.version} (≈{detail.download}).
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await settingsBridge.debugAdapterInstall(adapter.id);
                await refresh();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Installing…' : 'Install'}
          </button>
        </>
      ) : (
        !compact && (
          <p>
            {adapter.id} {adapter.version} · Installed
          </p>
        )
      )}
      {adapter.id === 'java-debug' && (
        <p>
          Java debugging needs jdtls on PATH and Java 21+.
          <br />
          jdtls: {adapter.jdtls || 'not found'} · Java: {adapter.javaMajor ?? 'not found'}
          {adapter.reason ? ` · ${adapter.reason}` : ''}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
