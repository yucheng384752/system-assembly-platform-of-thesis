import { createContext, useContext, useState, type ReactNode } from 'react';

const storageKey = 'composer-example-hints';
const HintSettings = createContext({ visible: true, setVisible: (_visible: boolean) => {} });

export function ExampleHintProvider({ children }: { children: ReactNode }) {
  const [visible, update] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'false'; }
    catch { return true; }
  });
  const setVisible = (next: boolean) => {
    update(next);
    try { localStorage.setItem(storageKey, String(next)); }
    catch { /* The preference still applies to this session when storage is unavailable. */ }
  };
  return <HintSettings.Provider value={{ visible, setVisible }}>{children}</HintSettings.Provider>;
}

export const useExampleHints = () => useContext(HintSettings).visible;

export function ExampleHintSwitch() {
  const { visible, setVisible } = useContext(HintSettings);
  return <label><input type="checkbox" role="switch" checked={visible} onChange={e => setVisible(e.target.checked)} />顯示填寫提示</label>;
}
