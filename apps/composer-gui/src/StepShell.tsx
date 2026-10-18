import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icons';

export interface StepInfo { number: string; title: string; lead: string; hint: string }
// The Workflow is the configuration entry point and every step is required (D17, D30); 03 參數設定 was added in D-A2.
export const steps: StepInfo[] = [
  { number: '01', title: '流程畫布', lead: '建立節點、標準表單與關聯，設定先後順序及子流程。', hint: '請使用職務名稱，勿填個資。' },
  { number: '02', title: '功能選配', lead: '確認流程所需功能，調整其他選配與畫面設定。', hint: '目前為設定與模擬預覽。' },
  { number: '03', title: '參數設定', lead: '調整各功能的初始參數，例如表格欄位顯示、預填值與報警門檻。', hint: '參數有範圍限制；場域鎖定的項目不能修改。' },
  { number: '04', title: '輸出', lead: '把設定打包成設定交付包，交付時只需要這一個檔案。', hint: '個別的流程規格與系統設定檔放在「進階」，用來重新載入設定。' },
];
// stepError: a non-empty message blocks confirming that step until the content is fixed.
export function StepShell({ renderStep, stepError = () => '' }: { renderStep: (step: number) => ReactNode; stepError?: (step: number) => string }) {
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const error = stepError(step);
  const current = steps[step];
  const shown = useRef(step);
  // Focus moves only on step change (not on load, nor on StrictMode effect replay) so the first Tab reaches the skip link.
  useEffect(() => { if (shown.current !== step) { shown.current = step; heading.current?.focus(); } }, [step]);
  return <>
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <header className="topbar">
      <nav aria-label="組裝步驟"><ol className="stepper">{steps.map((info, index) => {
        const done = completed.includes(index);
        return <li key={info.number}><button aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}>
          <span className={done ? 'step-number done' : 'step-number'}>{done ? <><Icon name="check" /><span className="visually-hidden">{info.number}</span></> : info.number}</span>
          {' '}<span className="step-name">{info.title}</span>{' '}
          {done ? <span className="step-state">已確認</span> : <span className="visually-hidden">待確認</span>}
        </button></li>;
      })}</ol></nav>
    </header>
    <main id="main-content" tabIndex={-1} className={step === 0 ? 'main-wide' : undefined}>
      <div className="page-head">
        <h1 ref={heading} tabIndex={-1}>{current.title}</h1>
      </div>
      <p className="lead">{current.lead}</p>
      {renderStep(step)}
      <footer className="step-actions">
        <p id="step-status" role="status"><Icon name={error ? 'warning' : 'info'} />{error ? `尚無法確認本步驟：${error}` : completed.includes(step) ? '已確認本步驟；修改後請再次確認。' : current.hint}</p>
        {step > 0 && <button onClick={() => setStep(step - 1)}>上一步</button>}
        <button className="primary" disabled={Boolean(error)} aria-describedby="step-status" onClick={() => { setCompleted(previous => [...new Set([...previous, step])]); if (step < steps.length - 1) setStep(step + 1); }}>{step < steps.length - 1 ? '確認並繼續' : '確認本步驟'}</button>
      </footer>
    </main>
  </>;
}
