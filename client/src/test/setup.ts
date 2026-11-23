import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
// @ts-expect-error: no type declarations; used only to measure SVG paths in jsdom (below).
import { svgPathProperties } from 'svg-path-properties';

// Animations finish instantly in tests, so exits and route changes don't need waiting for.
MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom lacks these browser APIs; components use them for motion preferences and reveals.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (!('IntersectionObserver' in window)) {
  class NoopIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(window, { IntersectionObserver: NoopIntersectionObserver });
}

window.scrollTo = () => {};

// jsdom's SVG paths can't measure themselves, but flubber (the Giving page's tree morph)
// measures paths when it sees a document. Give them the same measurement flubber uses
// outside browsers.
if (!('getTotalLength' in SVGElement.prototype)) {
  const measure = (element: SVGElement) => svgPathProperties(element.getAttribute('d') ?? '');
  Object.assign(SVGElement.prototype, {
    getTotalLength(this: SVGElement) {
      return measure(this).getTotalLength();
    },
    getPointAtLength(this: SVGElement, length: number) {
      return measure(this).getPointAtLength(length);
    },
  });
}
