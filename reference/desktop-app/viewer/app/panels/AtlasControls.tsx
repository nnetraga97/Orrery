import { useState } from 'react';
import { buildAtlas, useAtlas } from '../atlas.ts';

export function AtlasControls() {
  const atlas = useAtlas();
  const [error, setError] = useState('');
  if (!atlas) return null;
  const tokens = atlas.promptTokens + atlas.completionTokens;
  return (
    <section aria-label="Atlas">
      <h2>Atlas</h2>
      <div className="note" aria-live="polite">
        Atlas: {atlas.building ? atlas.done : atlas.count}/{atlas.total} functions ·{' '}
        {tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens
        {atlas.building ? ' · building' : atlas.stale ? ' · stale' : atlas.built ? '' : ' · not built'}
      </div>
      <button
        onClick={() => {
          setError('');
          void buildAtlas(atlas.building).catch(e => setError(e.message));
        }}
      >
        {atlas.building ? 'Cancel' : atlas.built ? 'Rebuild' : 'Build atlas'}
      </button>
      {(error || atlas.error) && (
        <p className="note" role="alert">
          {error || atlas.error}
        </p>
      )}
    </section>
  );
}
