import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { forgetScreens } from "@/lib/screen-memory";
import { i18n, SOURCE_LANGUAGE } from "@/lib/i18n";

// TRAK-180: no test starts from the screens another test left in memory.
afterEach(() => forgetScreens());
// TRAK-406: every test reads Trak in English unless it picks another language itself.
afterEach(async () => { if (i18n.language !== SOURCE_LANGUAGE) await i18n.changeLanguage(SOURCE_LANGUAGE) });


// TRAK-114: findBy/waitFor wait 1 s by default, and GitHub's runners can take longer than
// that for a full-provider render (main went red on 5 Oct). 4 s is what 45 calls already pass.
configure({ asyncUtilTimeout: 4000 });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// TRAK-163: Arc components measure themselves with ResizeObserver, which every
// browser Trak supports has and jsdom lacks. Nothing in jsdom ever resizes.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// TRAK-262: Arc's radar chart draws in when scrolled into view (IntersectionObserver), which
// every browser Trak supports has and jsdom lacks. Nothing in jsdom ever scrolls into view.
globalThis.IntersectionObserver ??= class {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
} as unknown as typeof IntersectionObserver;

// TRAK-182: Arc's Select (Radix) scrolls the chosen option into view and checks
// pointer capture, which every browser Trak supports has and jsdom lacks.
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
Element.prototype.hasPointerCapture ??= function hasPointerCapture() { return false }
// TRAK-340: dragging a part in Plan session (motion's Reorder) captures the pointer; jsdom has no pointer capture.
Element.prototype.setPointerCapture ??= function setPointerCapture() {}
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {}

// TRAK-172: the assessment carousel's Next/Previous scroll its viewport, which
// every browser Trak supports can do and jsdom can't.
Element.prototype.scrollTo ??= function scrollTo() {}
