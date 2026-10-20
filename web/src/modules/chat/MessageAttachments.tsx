// What a sent message carries (M1 #10): its images as thumbnails (a tap opens the picture large) and its files as chips. They are read from the
// lines Hermes keeps at the end of the message (`message-attachments.ts`).
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Lightbox } from './Lightbox.tsx';
import { AudioClip } from '../voice/AudioClip.tsx';
import { mediaUrl } from './media-url.ts';
import type { MessageAttachment } from './message-attachments.ts';

function Thumbnail({ attachment }: { attachment: MessageAttachment }) {
  const [url, setUrl] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    let current = true;
    void mediaUrl(attachment.path).then((found) => current && (found === undefined ? setFailed(true) : setUrl(found)));
    return () => {
      current = false;
    };
  }, [attachment.path]);
  if (failed) {
    return (
      <li className="msg-att msg-att--file" title={attachment.path}>
        <Icon name="file" small />
        <span className="msg-att__name">{attachment.name}</span>
        <span className="subtle msg-att__note">not on Hermes any more</span>
      </li>
    );
  }
  return (
    <li className="msg-att msg-att--image">
      <button type="button" className="msg-att__open" aria-label={`Open ${attachment.name}`} disabled={url === undefined} onClick={() => setZoomed(true)}>
        {url ? <img className="msg-att__image" src={url} alt={`Attached image ${attachment.name}`} loading="lazy" /> : <span className="msg-att__loading" aria-hidden="true" />}
      </button>
      {zoomed && url && <Lightbox src={url} alt={attachment.name} onClose={() => setZoomed(false)} />}
    </li>
  );
}

export function MessageAttachments({ attachments }: { attachments: readonly MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="msg-atts" aria-label={`Attachments, ${attachments.length}`}>
      {attachments.map((attachment) =>
        attachment.kind === 'image' ? (
          <Thumbnail key={`${attachment.kind}:${attachment.path}`} attachment={attachment} />
        ) : attachment.kind === 'audio' ? (
          <li key={`${attachment.kind}:${attachment.path}`} className="msg-att msg-att--audio" title={attachment.path}>
            <AudioClip path={attachment.path} name={attachment.name} />
          </li>
        ) : (
          <li key={`${attachment.kind}:${attachment.path}`} className="msg-att msg-att--file" title={attachment.path}>
            <Icon name="file" small />
            <span className="msg-att__name">{attachment.name}</span>
          </li>
        ),
      )}
    </ul>
  );
}
