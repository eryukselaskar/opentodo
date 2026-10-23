import { afterEach } from 'vitest';
import { useTodoStore } from '../store/useTodoStore';

// Existing tests assert the Turkish UI texts; English is covered in i18n.test.ts
useTodoStore.getState().setLanguage('tr');

// Browser APIs that jsdom lacks but Radix UI / the app touch. Only for jsdom test files.
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = window.ResizeObserver || (ResizeObserverStub as unknown as typeof ResizeObserver);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList);
}
