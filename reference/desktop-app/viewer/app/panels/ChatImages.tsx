import { useEffect, useRef, useState } from 'react';
import { messageImages, type CodexItem } from '../codex-chat.ts';

export function ChatImages({ item, threadId }: { item: CodexItem; threadId: string }) {
  const [images, setImages] = useState<{ name: string; src: string }[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // Deltas that don't add/change an image reference must not reread image files.
  const references = JSON.stringify([
    ...(item.content || []).filter(c => c.type === 'localImage').map(c => c.path),
    ...(item.imagePaths || []),
    ...(['imageView', 'imageGeneration'].includes(item.type || '') ? [item.path || item.result] : []),
    ...(item.text?.match(/!\[[^\]\n]*\]\([^\n]+?\)/g) || []),
  ]);
  useEffect(() => {
    let current = true;
    setImages([]);
    setError('');
    if (references !== '[]' && item.id)
      void messageImages(threadId, item.id)
        .then(result => {
          if (current) setImages(result);
        })
        .catch(() => {
          if (current) setError('Image preview unavailable.');
        });
    return () => {
      current = false;
    };
  }, [threadId, item.id, references]);
  useEffect(() => {
    if (selected != null && images[selected]) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected, images]);
  if (!images.length) return error ? <p className="codex-muted">{error}</p> : null;
  return (
    <div className="codex-chat-images">
      {images.map((image, index) => (
        <button
          key={`${index}:${image.name}`}
          type="button"
          className="codex-image-preview"
          aria-label={`View ${image.name}`}
          onClick={() => setSelected(index)}
        >
          <img src={image.src} alt={image.name} loading="lazy" />
          <span>{image.name}</span>
        </button>
      ))}
      <dialog
        ref={dialog}
        className="codex-image-dialog"
        aria-label="Image viewer"
        onClose={() => setSelected(null)}
        onClick={e => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <form method="dialog">
          <span>{selected != null && images[selected]?.name}</span>
          <button autoFocus>Close</button>
        </form>
        {selected != null && images[selected] && <img src={images[selected].src} alt={images[selected].name} />}
      </dialog>
    </div>
  );
}
