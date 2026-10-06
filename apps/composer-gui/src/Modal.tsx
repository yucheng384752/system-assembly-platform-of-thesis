import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const focusable = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// A dialog centred on the screen over a dimmed backdrop (D88). It is mounted on <body> so no panel can sit above it, keeps the
// keyboard inside, closes on Escape, the close button or a press on the backdrop, and gives focus back to `returnFocusTo` (some
// browsers do not focus a button when it is clicked, so the element that was focused at opening cannot be relied on).
export function Modal({ title, onClose, returnFocusTo, children }: { title: string; onClose: () => void; returnFocusTo?: RefObject<HTMLElement | null>; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      const target = returnFocusTo?.current ?? opener;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, []);
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(focusable)].filter(e => !e.closest('[hidden]') && !e.closest('details:not([open])') || e.tagName === 'SUMMARY');
    if (!items.length) { event.preventDefault(); return; }
    const [first, last] = [items[0], items[items.length - 1]];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return createPortal(
    <div className="modal-backdrop" onKeyDown={keys} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="modal-head"><h3>{title}</h3><button onClick={onClose}>關閉全螢幕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>, document.body);
}
