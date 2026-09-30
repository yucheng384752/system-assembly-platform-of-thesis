import { useEffect, useRef, useState, type ReactNode } from 'react';

export const steps = ['01 資料上傳', '02 功能選配', '03 輸出下載套件', '04 AoV 設定'];
// Optional steps may be skipped; they are never shown as pending.
export const optionalSteps = [3];
export function StepShell({ renderStep }: { renderStep: (step: number) => ReactNode }) {
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);
  // Focus moves only on step change (not on load, nor on StrictMode effect replay) so the first Tab reaches the skip link.
  useEffect(() => { if (shown.current !== step) { shown.current = step; heading.current?.focus(); } }, [step]);
  return <>
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <header><strong>Composer 系統組裝</strong><p>選擇需要的功能，確認畫面，下載設定。</p></header>
    <nav className="steps" aria-label="組裝步驟">{steps.map((title, index) => <button key={title}
      aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % steps.length : event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); setStep(next); }
      }}>{title}{completed.includes(index) ? '（已確認）' : optionalSteps.includes(index) ? '（非必要填寫）' : '（待確認）'}</button>)}</nav>
    <main id="main-content" tabIndex={-1}>
      <h1 ref={heading} tabIndex={-1}>{steps[step]}</h1>
      {optionalSteps.includes(step) && <p>此步驟非必要填寫，可以直接略過。</p>}
      {renderStep(step)}
      <footer className="step-actions">
        {step > 0 && <button onClick={() => setStep(step - 1)}>上一步</button>}
        <button onClick={() => { setCompleted(previous => [...new Set([...previous, step])]); if (step < steps.length - 1) setStep(step + 1); }}>確認本步驟{step < steps.length - 1 ? '並繼續' : ''}</button>
        <p role="status">{completed.includes(step) ? '已確認本步驟；修改後請再次確認。' : optionalSteps.includes(step) ? '此步驟非必要填寫。' : '請確認本步驟內容。'}</p>
      </footer>
    </main>
  </>;
}
