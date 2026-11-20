import './media-diff.css';

import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { signal } from 'kerfjs';
import { Blend, Code, Columns2, Info, PanelLeft, PanelRight, Rows2, Scan, Split, ZoomIn, ZoomOut } from 'lucide';

import type { ImageRegion, Side } from '../discussion/discussion-state.js';
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

type Mode = (typeof modes)[number]['key'];
type Images = MediaSides<MediaImage>;
const sides = ['before', 'after'] as const;
const labels = { before: 'Before', after: 'After' };

export function createMediaDiffState() {
  return { mode: signal<Mode>('split'), zoom: signal(100), slice: signal(50), drawing: signal(false) };
}

type State = ReturnType<typeof createMediaDiffState>;

export function MediaDiffToolbar({ id, images, state }: { id: string; images: Images; state: State }) {
  const both = images.before !== null && images.after !== null;
  return (
    <>
      <ToolbarControlGroup label="Image Comparison" content="icon" overflow="wrap">
        {modes
          .filter(({ key }) => {
            if (key === 'source') return images.before?.source !== undefined || images.after?.source !== undefined;
            if (key === 'before' || key === 'after') return images[key] !== null;
            return both || key === 'split' || key === 'metadata';
          })
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
            disabled={state.mode.value === 'difference' || state.mode.value === 'slice'}
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
  return (
    <div class="media-diff" data-media-diff={id} data-mode={mode} data-drawing={String(state.drawing.value)}>
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
                    <div class="media-diff__viewport" tabindex="0" aria-label={`Pan ${labels[side]} Image`}>
                      <div class="media-diff__image" style={`width: ${state.zoom.value}%`}>
                        <img src={image.url} alt={`${labels[side]} image`} data-media-side={side} draggable="false" />
                        {regions
                          .filter((region) => region.side === side)
                          .map(({ id, target }) => (
                            <button
                              class="media-diff__region"
                              type="button"
                              data-action={`discussion-show:${id}`}
                              aria-label={`Open Region Comment ${id}`}
                              style={`left:${target.left * 100}%;top:${target.top * 100}%;width:${target.width * 100}%;height:${target.height * 100}%`}
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
        state.drawing.value = false;
      }
      if (key === 'in') state.zoom.value = Math.min(400, state.zoom.value + 25);
      if (key === 'out') state.zoom.value = Math.max(100, state.zoom.value - 25);
      if (key === 'region') state.drawing.value = !state.drawing.value;
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
      state.drawing.value = false;
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
