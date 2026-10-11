import markUrl from './brand/mark.png';
import wordmarkUrl from './brand/wordmark.png';
import { h } from './dom';

/** The logo artwork is a white alpha mask, so CSS tints it with `background-color`. */
function logo(cls: string, url: string, label: string): HTMLElement {
  const el = h('span', { class: cls, role: 'img', 'aria-label': label });
  el.style.setProperty('mask-image', `url("${url}")`);
  el.style.setProperty('-webkit-mask-image', `url("${url}")`);
  return el;
}

/** The "M" skyline mark. */
export const brandMark = (cls = ''): HTMLElement => logo(`logo-mark ${cls}`.trim(), markUrl, 'Meridian');

/** The full MERIDIAN skyline wordmark. */
export const brandWordmark = (cls = ''): HTMLElement => logo(`logo-word ${cls}`.trim(), wordmarkUrl, 'Meridian');
