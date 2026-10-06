import type { ReactNode } from 'react';

// One column of the three-column page layout; the heading names the region for assistive tech.
// scroll: the column scrolls on its own, so it must be reachable by keyboard.
export function Column({ id, title, lead, aside, className, scroll, children }: { id: string; title: ReactNode; lead?: string; aside?: ReactNode; className?: string; scroll?: boolean; children: ReactNode }) {
  return <section className={['column', className].filter(Boolean).join(' ')} aria-labelledby={`${id}-title`} tabIndex={scroll ? 0 : undefined}>
    <div className="column-head"><h2 id={`${id}-title`}>{title}</h2>{aside}</div>
    {lead && <p className="lead">{lead}</p>}
    {children}
  </section>;
}
