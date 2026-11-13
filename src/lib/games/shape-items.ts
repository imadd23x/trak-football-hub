import { i18n } from '@/lib/i18n'
import { FORMATIONS, FORMATS } from './formations'

/* TRAK-453: the one list behind "format and shape", on a match's line-up and on a saved formation: a header per format
   ("9 a side") with its shapes under it, so picking a shape in another format switches the format. TRAK-407: read when
   shown, so "9 a side" follows the language. */
export const shapeItems = () => FORMATS.map(format => ({
  label: i18n.t('coachSquad:fmASide', { count: format }),
  options: FORMATIONS[format].map(shape => ({ value: shape, label: shape })),
}))
