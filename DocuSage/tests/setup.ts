import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }] as unknown as DOMRectList;
