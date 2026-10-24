// work.ts: the Work plates' locators (Locator.astro). Motion M8: the active box's fill fades in
// once, when its plate comes into view. With motion off it is simply shown.
import { motionAllowed, onMotionChange } from '../../components/ui/motion';
import { onFirstView } from './view';

const locators = Array.from(document.querySelectorAll<SVGElement>('[data-locator]'));
const showAll = () => locators.forEach((el) => el.classList.add('is-on'));

if (!motionAllowed()) {
  showAll();
} else {
  locators.forEach((el) => {
    const plate = el.closest('[data-project]') ?? el;
    onFirstView(plate, 0.2, () => el.classList.add('is-on'));
  });
}

onMotionChange((enabled) => {
  if (!enabled) showAll();
});
