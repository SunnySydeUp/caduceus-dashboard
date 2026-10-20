// An image, large (M1 #04): a dialog layer over the shell, so focus is held in it, Escape and Back close it, and the page behind is inert.
import { useId } from 'react';
import { Icon } from '../../icons.tsx';
import { Layer } from '../../overlays/Layer.tsx';

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose(): void }) {
  const titleId = useId();
  return (
    <Layer kind="dialog" className="lightbox-layer" panelClassName="dialog lightbox" labelledBy={titleId} onClose={onClose} initialFocus="[data-close]">
      <div className="lightbox__bar">
        <h2 className="lightbox__title" id={titleId}>
          {alt || 'Image'}
        </h2>
        <a className="btn btn--ghost btn--sm" href={src} target="_blank" rel="noopener noreferrer">
          <Icon name="external" small />
          Open original
        </a>
        <button type="button" className="btn btn--ghost btn--icon" data-close onClick={onClose} aria-label="Close image">
          <Icon name="x" />
        </button>
      </div>
      <div className="lightbox__stage" data-body>
        <img src={src} alt={alt} className="lightbox__image" referrerPolicy="no-referrer" />
      </div>
    </Layer>
  );
}
