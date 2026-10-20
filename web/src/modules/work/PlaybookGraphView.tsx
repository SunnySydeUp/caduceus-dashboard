// The graph, loaded when it is first asked for (M6 #04): `PlaybookGraph.tsx`, the layout it draws and its styles are a chunk of their own, so the screens that
// offer the graph carry none of it. Only the props' type is imported from there, and a type is gone from the build.
import { lazy, Suspense } from 'react';
import type { PlaybookGraphProps } from './PlaybookGraph.tsx';

const PlaybookGraph = lazy(() => import('./PlaybookGraph.tsx'));

export function PlaybookGraphView(props: PlaybookGraphProps) {
  return (
    <Suspense fallback={<p role="status">Loading the graph…</p>}>
      <PlaybookGraph {...props} />
    </Suspense>
  );
}
