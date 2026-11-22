import { batch, effect, signal } from 'kerfjs';

import type { Definition } from './definition-navigation.js';
import type { ReviewSourceState } from './review-source.js';

type Position = { top: number; left: number };
type Visit = { index: number; position: Position | null; definition?: Definition };
type Direction = -1 | 1;

export function createReviewHistory() {
  const visits = signal<Visit[]>([]);
  const cursor = signal(-1);

  function current() {
    return visits.peek()[cursor.peek()];
  }

  function active() {
    return visits.value[cursor.value];
  }

  function visit(index: number) {
    const previous = current();
    if (previous?.index === index && previous.definition === undefined) return;
    push({ index, position: { top: 0, left: 0 } });
  }

  function visitDefinition(origin: number, definition: Definition) {
    push({ index: definition.index ?? origin, position: null, definition });
  }

  function push(visit: Visit) {
    const next = [...visits.peek().slice(0, cursor.peek() + 1), visit];
    batch(() => {
      visits.value = next;
      cursor.value = next.length - 1;
    });
  }

  function move(direction: Direction) {
    const next = cursor.peek() + direction;
    const destination = visits.peek()[next];
    if (destination !== undefined) cursor.value = next;
    return destination;
  }

  function save(position: Position) {
    const visit = current();
    if (visit !== undefined) visit.position = position;
  }

  function clear() {
    visits.value = [];
    cursor.value = -1;
  }

  function canMove(direction: Direction) {
    return visits.value[cursor.value + direction] !== undefined;
  }

  return { current, active, visit, visitDefinition, move, save, clear, canMove };
}

type History = ReturnType<typeof createReviewHistory>;

const mainSelector = '[data-workbench-main][aria-label="Comparison"] > [data-component="pane"] > .kui-pane__content';

export function wireReviewHistory(
  root: HTMLElement,
  source: ReviewSourceState,
  history: History,
  contentReady: () => boolean,
  beforeMove: () => Promise<boolean>,
) {
  const controller = new AbortController();
  const { signal: abort } = controller;
  const scroller = () => {
    const pane = root.querySelector<HTMLElement>(mainSelector);
    return pane?.querySelector<HTMLElement>('.text-diff') ?? pane;
  };
  let observedReview = source.review.value;
  let visible: Visit | undefined;

  function saveVisible() {
    const region = scroller();
    if (region !== null && visible !== undefined && history.current() === visible) {
      history.save({ top: region.scrollTop, left: region.scrollLeft });
    }
  }

  const stop = effect(() => {
    const review = source.review.value;
    const pending = source.pending.value;
    const index = source.selected.value;
    const ready = contentReady();
    if (observedReview !== review) {
      observedReview = review;
      visible = undefined;
      history.clear();
    }
    if (pending || index === undefined) {
      visible = undefined;
      return;
    }
    if (history.current()?.index !== index) history.visit(index);
    const destination = history.active();
    if (!ready) {
      visible = undefined;
      return;
    }
    if (destination === undefined || visible === destination) return;
    const frame = requestAnimationFrame(() => {
      const region = scroller();
      if (region === null) return;
      visible = destination;
      if (destination.position !== null) {
        region.scrollTo({ ...destination.position, behavior: 'instant' });
      } else {
        const target = region.querySelector<HTMLElement>('[data-definition-target]');
        if (target !== null) {
          const top = target.getBoundingClientRect().top - region.getBoundingClientRect().top + region.scrollTop;
          region.scrollTo({ top: top - region.clientHeight / 3, left: 0, behavior: 'instant' });
        }
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  function move(direction: Direction) {
    if (source.pending.value || !history.canMove(direction)) return;
    const visit = history.current();
    void beforeMove().then((saved) => {
      if (abort.aborted || !saved || source.pending.value || history.current() !== visit) return;
      saveVisible();
      batch(() => {
        const destination = history.move(direction);
        if (destination === undefined) return;
        visible = undefined;
        source.fileActionStatus.value = '';
        source.selected.value = destination.index;
      });
    });
  }

  async function reveal(definition: Definition) {
    const visit = history.current();
    const index = source.selected.value;
    const current = () =>
      !abort.aborted && !source.pending.value && history.current() === visit && source.selected.value === index;
    if (index === undefined || !current() || !(await beforeMove()) || !current()) return;
    saveVisible();
    batch(() => {
      history.visitDefinition(index, definition);
      source.fileActionStatus.value = '';
      source.selected.value = definition.index ?? index;
    });
  }

  root.addEventListener(
    'scroll',
    (event) => {
      if (event.target === scroller()) saveVisible();
    },
    { signal: abort, capture: true, passive: true },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>('[data-action]');
      const action = control?.dataset.action;
      if (action === 'review-history-back' || action === 'review-history-forward') {
        event.stopImmediatePropagation();
        move(action === 'review-history-back' ? -1 : 1);
      } else if (action === 'review-file-select') {
        saveVisible();
        const row = control?.dataset.itemId ?? control?.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
        const index = source.selected.value;
        if (history.current()?.definition !== undefined && index !== undefined && row === `file:${index}`) {
          history.visit(index);
        }
      }
    },
    { signal: abort, capture: true },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey || root.querySelector('dialog[open]') !== null)
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable], kui-select') !== null
      )
        return;
      let direction: Direction | undefined;
      if (event.metaKey && !event.altKey && (event.key === '[' || event.key === ']'))
        direction = event.key === '[' ? -1 : 1;
      if (event.altKey && !event.metaKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        direction = event.key === 'ArrowLeft' ? -1 : 1;
      }
      if (direction !== undefined && source.review.value !== null) {
        event.preventDefault();
        move(direction);
      }
    },
    { signal: abort },
  );

  return {
    reveal,
    dispose() {
      controller.abort();
      stop();
    },
  };
}
