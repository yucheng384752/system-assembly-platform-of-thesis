import { useEffect, useRef, useState, type ReactNode } from 'react';

export const steps = ['01 選擇業務流程', '02 資料來源與表單設計', 'AOV 流程規格', '03 輸出部署套件'];
export function StepShell({ renderStep }: { renderStep: (step: number) => ReactNode }) {
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  return <>
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <header><strong>Composer 系統組裝</strong><p>選擇需要的功能，確認畫面，下載設定。</p></header>
    <nav className="steps" aria-label="組裝步驟">{steps.map((title, index) => <button key={title}
      aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % steps.length : event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); setStep(next); }
      }}>{title}{completed.includes(index) ? '（已確認）' : '（待確認）'}</button>)}</nav>
    <main id="main-content" tabIndex={-1}>
      <h1 ref={heading} tabIndex={-1}>{steps[step]}</h1>
      {renderStep(step)}
      <footer className="step-actions">
        {step > 0 && <button onClick={() => setStep(step - 1)}>上一步</button>}
        <button onClick={() => { setCompleted(previous => [...new Set([...previous, step])]); if (step < steps.length - 1) setStep(step + 1); }}>確認本步驟{step < steps.length - 1 ? '並繼續' : ''}</button>
        <p role="status">{completed.includes(step) ? '已確認本步驟；修改後請再次確認。' : '請確認本步驟內容。'}</p>
      </footer>
    </main>
  </>;
}
