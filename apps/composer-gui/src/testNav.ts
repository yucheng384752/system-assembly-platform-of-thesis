import { fireEvent, screen } from '@testing-library/react';

// The app opens on 首頁 (D63); flow tests start from the 流程 page like a user would.
export function openFlow() { fireEvent.click(screen.getByRole('button', { name: '流程' })); }
