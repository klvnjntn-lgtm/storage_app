import type { ReactNode } from 'react';

/* A print design is a paper layout, so the editor stays in light mode even
   when the app is dark: the `force-light` marker opts the whole page out of
   the dark palette in theme.css. `contents` keeps the wrapper out of layout. */
export default function PrintDesignEditorLayout({ children }: { children: ReactNode }) {
  return <div className="force-light contents">{children}</div>;
}
