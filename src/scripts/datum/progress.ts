// progress.ts: draws the Progress charts once, when each is half on screen (motion M10; the
// transitions themselves are CSS in Progress.astro). With motion off they are drawn at once.
import { motionAllowed, onMotionChange } from '../../components/ui/motion';
import { onFirstView } from './view';

const charts = Array.from(document.querySelectorAll<SVGElement>('[data-pchart]'));
const drawAll = () => charts.forEach((el) => el.classList.add('is-drawn'));

if (!motionAllowed()) {
  drawAll();
} else {
  charts.forEach((el) => onFirstView(el, 0.5, () => el.classList.add('is-drawn')));
}

onMotionChange((enabled) => {
  if (!enabled) drawAll();
});
