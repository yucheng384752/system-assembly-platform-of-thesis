import { mount } from './bootstrap';

const root = document.getElementById('root');
if (!root) throw new Error('缺少應用程式掛載節點');
void mount(root, () => import('./App'));
