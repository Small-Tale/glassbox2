import './media-diff.css';

import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { signal } from 'kerfjs';
import { Blend, Code, Columns2, Info, PanelLeft, PanelRight, Rows2, Scan, Split, ZoomIn, ZoomOut } from 'lucide';

import type { ImageRegion, Side } from '../discussion/discussion-state.js';
import { type MediaMode, modeAvailable } from './media-mode.js';
import { changeRegion, initialRegion, regionAnchor, type RegionBounds } from './media-region.js';
import type { MediaImage } from './selected-diff.js';
import type { MediaSides } from './text-diff-model.js';

const modes = [
  { key: 'split', label: 'Side by Side', icon: Columns2, name: 'columns-2' },
  { key: 'stack', label: 'Over and Under', icon: Rows2, name: 'rows-2' },
  { key: 'before', label: 'Before Image', icon: PanelLeft, name: 'panel-left' },
  { key: 'after', label: 'After Image', icon: PanelRight, name: 'panel-right' },
  { key: 'difference', label: 'Difference', icon: Blend, name: 'blend' },
  { key: 'slice', label: 'Slice', icon: Split, name: 'split' },
  { key: 'metadata', label: 'Image Metadata', icon: Info, name: 'info' },
  { key: 'source', label: 'SVG Source', icon: Code, name: 'code' },
] as const;

type Mode = MediaMode;

export function mediaModeLabel(mode: MediaMode): string {
  return modes.find(({ key }) => key === mode)?.label ?? mode;
}
type Images = MediaSides<MediaImage>;
const sides = ['before', 'after'] as const;
const labels = { before: 'Before', after: 'After' };

export function createMediaDiffState() {
  return {
    mode: signal<Mode>('split'),
    // The mode the user chose last. `mode` is what the current image can show (HS2-Q3X4BX).
    preferred: signal<Mode>('split'),
    zoom: signal(100),
    slice: signal(50),
    drawing: signal(false),
    // Label of the mode that was unavailable for the last file, shown until the user picks one.
    fallback: signal<string | null>(null),
    keyboardRegion: signal<{ side: Side; bounds: RegionBounds } | null>(null),
  };
}

type State = ReturnType<typeof createMediaDiffState>;

function regionStyle({ left, top, width, height }: ImageRegion) {
  return `left:${left * 100}%;top:${top * 100}%;width:${width * 100}%;height:${height * 100}%`;
}

export function MediaDiffToolbar({
  id,
  images,
  state,
  allowRegions = true,
}: {
  id: string;
  images: Images;
  state: State;
  allowRegions?: boolean;
}) {
  return (
    <>
      <ToolbarControlGroup label="Image Comparison" content="icon" overflow="wrap">
        {modes
          .filter(({ key }) => modeAvailable(key, images))
          .map(({ key, label, icon, name }) => (
            <ToolbarButton
              action={`${id}:${key}`}
              pressed={state.mode.value === key}
              ariaLabel={label}
              title={label}
              icon={<LucideIcon icon={icon} name={name} />}
            />
          ))}
      </ToolbarControlGroup>
      {state.mode.value === 'metadata' || state.mode.value === 'source' ? null : (
        <ToolbarControlGroup label="Image Tools" content="icon">
          <ToolbarButton
            action={`${id}:out`}
            disabled={state.zoom.value <= 100}
            ariaLabel="Zoom Out"
            title="Zoom Out"
            icon={<LucideIcon icon={ZoomOut} name="zoom-out" />}
          />
          <ToolbarButton
            action={`${id}:in`}
            disabled={state.zoom.value >= 400}
            ariaLabel="Zoom In"
            title="Zoom In"
            icon={<LucideIcon icon={ZoomIn} name="zoom-in" />}
          />
          <ToolbarButton
            action={`${id}:region`}
            pressed={state.drawing.value}
            ariaLabel="Add Region Comment"
            title="Add Region Comment"
            disabled={!allowRegions || state.mode.value === 'difference' || state.mode.value === 'slice'}
            icon={<LucideIcon icon={Scan} name="scan" />}
          />
        </ToolbarControlGroup>
      )}
    </>
  );
}

export function MediaDiff({
  id,
  images,
  state,
  regions = [],
}: {
  id: string;
  images: Images;
  state: State;
  regions?: { side: Side; id: number; target: ImageRegion }[];
}) {
  const mode = state.mode.value;
  const drawing = state.drawing.value;
  const keyboardRegion = drawing ? state.keyboardRegion.value : null;
  return (
    <div class="media-diff" data-media-diff={id} data-mode={mode} data-drawing={String(drawing)}>
      {state.fallback.value === null ? null : (
        <div class="media-diff__instructions" role="status">
          {state.fallback.value} is not available for this image, so Side by Side is shown.
        </div>
      )}
      {drawing ? (
        <div class="media-diff__instructions" id={`${id}-region-help`}>
          Drag on an image, or focus it and use arrow keys to move the region. Hold Shift to resize. Press Enter to add
          a comment or Escape to cancel.
          <div role="status">
            {keyboardRegion === null
              ? null
              : `${labels[keyboardRegion.side]} region at ${keyboardRegion.bounds.left}% from the left and ${keyboardRegion.bounds.top}% from the top, ${keyboardRegion.bounds.width}% wide by ${keyboardRegion.bounds.height}% high.`}
          </div>
        </div>
      ) : null}
      {mode === 'difference' || mode === 'slice' ? (
        <>
          {mode === 'slice' ? (
            <label>
              Slice position <input type="range" data-media-slice value={String(state.slice.value)} />
            </label>
          ) : null}
          <div class="media-diff__viewport" tabindex="0" aria-label="Overlaid Images">
            <div
              class="media-diff__overlay"
              style={`width: ${state.zoom.value}%; --glassbox-slice: ${state.slice.value}%`}
            >
              {sides.map((side) => (
                <img src={images[side]?.url} alt={labels[side]} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <div class="media-diff__panes">
          {sides
            .filter((side) => images[side] !== null && ((mode !== 'before' && mode !== 'after') || mode === side))
            .map((side) => {
              const image = images[side];
              if (image === null) return null;
              return (
                <section class="media-diff__pane" aria-label={labels[side]}>
                  <div class="media-diff__label">{labels[side]}</div>
                  {mode === 'metadata' ? (
                    <dl>
                      <dt>Type</dt>
                      <dd>{image.content_type}</dd>
                      <dt>Size</dt>
                      <dd>{image.size.toLocaleString()} bytes</dd>
                    </dl>
                  ) : mode === 'source' ? (
                    <pre>{image.source ?? 'SVG source is unavailable for this side.'}</pre>
                  ) : (
                    <div
                      class="media-diff__viewport"
                      tabindex="0"
                      data-media-region-side={side}
                      aria-label={drawing ? `Select ${labels[side]} Image Region` : `Pan ${labels[side]} Image`}
                      aria-describedby={drawing ? `${id}-region-help` : undefined}
                    >
                      <div class="media-diff__image" style={`width: ${state.zoom.value}%`}>
                        <img src={image.url} alt={`${labels[side]} image`} data-media-side={side} draggable="false" />
                        {keyboardRegion?.side === side ? (
                          <div
                            class="media-diff__region media-diff__region--draft"
                            aria-hidden="true"
                            style={regionStyle(regionAnchor(keyboardRegion.bounds))}
                          />
                        ) : null}
                        {regions
                          .filter((region) => region.side === side)
                          .map(({ id, target }) => (
                            <button
                              class="media-diff__region"
                              type="button"
                              data-action={`discussion-show:${id}`}
                              aria-label={`Open Region Comment ${id}`}
                              style={regionStyle(target)}
                            />
                          ))}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function wireMediaDiff(
  root: HTMLElement,
  id: string,
  state: State,
  onRegion?: (side: Side, target: ImageRegion) => void,
) {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let drag: { image: HTMLImageElement; pointer: number; side: Side; x: number; y: number } | undefined;
  function endRegion() {
    state.drawing.value = false;
    state.keyboardRegion.value = null;
  }
  function regionSide(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return undefined;
    if (target.closest<HTMLElement>('[data-media-diff]')?.dataset.mediaDiff !== id) return undefined;
    const side = target.dataset.mediaRegionSide;
    return side === 'before' || side === 'after' ? side : undefined;
  }
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('button[data-action]')?.dataset.action;
      if (action === undefined || !action.startsWith(`${id}:`)) return;
      const key = action.slice(id.length + 1);
      const mode = modes.find((entry) => entry.key === key);
      if (mode !== undefined) {
        state.mode.value = mode.key;
        state.preferred.value = mode.key;
        state.fallback.value = null;
        endRegion();
      }
      if (key === 'in') state.zoom.value = Math.min(400, state.zoom.value + 25);
      if (key === 'out') state.zoom.value = Math.max(100, state.zoom.value - 25);
      if (key === 'region') {
        if (state.drawing.value) endRegion();
        else state.drawing.value = true;
      }
    },
    options,
  );
  root.addEventListener(
    'focusin',
    (event) => {
      const side = regionSide(event.target);
      if (state.drawing.value && side !== undefined && state.keyboardRegion.value?.side !== side) {
        state.keyboardRegion.value = { side, bounds: initialRegion };
      }
    },
    options,
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const side = regionSide(event.target);
      if (!state.drawing.value || side === undefined) return;
      const current = state.keyboardRegion.value;
      const bounds = current?.side === side ? current.bounds : initialRegion;
      if (event.key === 'Escape') {
        event.preventDefault();
        endRegion();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        endRegion();
        onRegion?.(side, regionAnchor(bounds));
      } else {
        const next = changeRegion(bounds, event.key, event.shiftKey);
        if (next === undefined) return;
        event.preventDefault();
        state.keyboardRegion.value = { side, bounds: next };
      }
    },
    options,
  );
  root.addEventListener(
    'input',
    (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.matches(`[data-media-diff="${id}"] [data-media-slice]`)) {
        state.slice.value = input.valueAsNumber;
      }
    },
    options,
  );
  root.addEventListener(
    'pointerdown',
    (event) => {
      const image = event.target;
      if (!state.drawing.value || event.button !== 0 || !(image instanceof HTMLImageElement)) return;
      if (image.closest<HTMLElement>('[data-media-diff]')?.dataset.mediaDiff !== id) return;
      const side = image.dataset.mediaSide;
      if (side !== 'before' && side !== 'after') return;
      drag = { image, pointer: event.pointerId, side, x: event.clientX, y: event.clientY };
      image.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    options,
  );
  root.addEventListener(
    'lostpointercapture',
    () => {
      drag = undefined;
    },
    options,
  );
  root.addEventListener(
    'pointerup',
    (event) => {
      if (drag === undefined || drag.pointer !== event.pointerId) return;
      const { image, side, x, y } = drag;
      drag = undefined;
      const bounds = image.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const startX = clamp((x - bounds.left) / bounds.width);
      const startY = clamp((y - bounds.top) / bounds.height);
      const endX = clamp((event.clientX - bounds.left) / bounds.width);
      const endY = clamp((event.clientY - bounds.top) / bounds.height);
      const width = Math.abs(startX - endX);
      const height = Math.abs(startY - endY);
      if (width * bounds.width < 4 || height * bounds.height < 4) return;
      endRegion();
      onRegion?.(side, {
        kind: 'image_region',
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        width,
        height,
      });
    },
    options,
  );
  return () => {
    controller.abort();
  };
}
