// Decorative inline icons (no icon library). Every icon sits next to visible text, so all are hidden from assistive tech.
const paths = {
  logo: 'M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 5 4.5 2.5v5L12 17l-4.5-2.5v-5L12 7Z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5M9 13h6M9 17h6',
  check: 'm5 12 5 5 9-10',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-9.5v.5',
  warning: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v6m0 3.5v.5',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v6m4-6v6',
  plus: 'M12 5v14M5 12h14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1m2 4a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  chevron: 'm9 6 6 6-6 6',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  minus: 'M6 12h12',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={['icon', className].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill={name === 'logo' ? 'currentColor' : 'none'} stroke={name === 'logo' ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} fillRule="evenodd" />
  </svg>;
}
