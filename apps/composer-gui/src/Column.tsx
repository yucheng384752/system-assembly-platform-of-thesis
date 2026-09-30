import type { ReactNode } from 'react';

// One column of the three-column page layout; the heading names the region for assistive tech.
export function Column({ id, title, lead, aside, className, children }: { id: string; title: ReactNode; lead?: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={['column', className].filter(Boolean).join(' ')} aria-labelledby={`${id}-title`}>
    <div className="column-head"><h2 id={`${id}-title`}>{title}</h2>{aside}</div>
    {lead && <p className="lead">{lead}</p>}
    {children}
  </section>;
}
