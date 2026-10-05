import { fireEvent, screen } from '@testing-library/react';

// The app opens on 首頁 (D63); flow tests start from the 流程 page like a user would.
export function openFlow() { fireEvent.click(screen.getByRole('button', { name: '流程' })); }

// The canvas starts on the factory list (D79): name a factory, then create its first production logic, which opens the canvas.
export function startLogic(factory = 'A 廠') {
  fireEvent.change(screen.getByLabelText('工廠名稱'), { target: { value: factory } });
  fireEvent.click(screen.getByRole('button', { name: '建立生產邏輯：新工廠' }));
}
