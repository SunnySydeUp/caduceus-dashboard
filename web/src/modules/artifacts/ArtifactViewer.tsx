// Opens one artifact (M6 #05): Markdown with its citations, an image, a PDF, plain text, or an HTML page in the empty sandbox. A file of any other kind has nothing
// to show and is offered as a download only. The file is read from Caduceus; nothing here draws raw HTML outside the sandbox.
import type { Artifact } from '@caduceus/contracts/artifacts';
import { Icon } from '../../icons.tsx';
import '../chat/chat.css';
import { CodeBlock, Rich } from '../chat/Rich.tsx';
import { htmlFrame } from '../files/files-model.ts';
import { contentUrl, isViewable, sizeWords } from './artifacts-model.ts';
import { useContent } from './artifacts-data.ts';

export function DownloadButton({ artifact }: { artifact: Artifact }) {
  return (
    <a className="btn btn--secondary btn--sm" href={contentUrl(artifact.id, true)} download={artifact.name}>
      <Icon name="download" small />
      Download ({sizeWords(artifact.size)})
    </a>
  );
}

function Body({ artifact }: { artifact: Artifact }) {
  const content = useContent(artifact);
  if (!isViewable(artifact.kind)) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="file" />
        </span>
        <p>Caduceus does not know how to show this kind of file, so it is offered as a download only.</p>
        <DownloadButton artifact={artifact} />
      </div>
    );
  }
  if (content.state === 'loading') return <p role="status">Loading…</p>;
  if (content.state === 'failed') {
    return (
      <p className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">{content.message}</span>
      </p>
    );
  }
  if (content.state === 'object') {
    return artifact.kind === 'image' ? <img className="art-image" src={content.src} alt={artifact.title} /> : <iframe className="art-frame" src={content.src} title={`${artifact.title} (PDF)`} />;
  }
  const cutNote = content.cut && <p className="subtle">Only the start of this file is shown. Download it for all of it.</p>;
  if (artifact.kind === 'markdown') {
    return (
      <>
        <Rich text={content.text} anchor={`artifact-${artifact.id}`} />
        {cutNote}
      </>
    );
  }
  if (artifact.kind === 'html') {
    const frame = htmlFrame(content.text);
    return <iframe className="art-frame" sandbox={frame.sandbox} srcDoc={frame.srcDoc} title={`${artifact.title} (HTML page, sandboxed)`} />;
  }
  return (
    <>
      <CodeBlock lang="" text={content.text} open={false} />
      {cutNote}
    </>
  );
}

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  return (
    <div className="art-view" data-kind={artifact.kind}>
      <Body artifact={artifact} />
    </div>
  );
}
