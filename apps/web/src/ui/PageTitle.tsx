import type { ReactNode } from 'react';

export interface PageTitleProps {
  /** The title as written ("Mission report"); its last word carries the accent colour. */
  title: string;
  /** One mono line under the title. */
  line?: ReactNode;
}

/** The slim page header of the redesigned screens: lowercase serif title, one mono line. */
export function PageTitle({ title, line }: PageTitleProps) {
  const at = title.lastIndexOf(' ');
  const rest = at === -1 ? '' : `${title.slice(0, at)} `;
  const last = at === -1 ? title : title.slice(at + 1);
  return (
    <header className="page-head">
      <h1 className="page-title">
        {rest}
        <em>{last}</em>
      </h1>
      {line !== undefined && <p className="page-line">{line}</p>}
    </header>
  );
}
