import dark from './dark.css?raw'
import light from './light.css?raw'
import rosePine from './rose-pine.css?raw'
import rosePineMoon from './rose-pine-moon.css?raw'
import rosePineDawn from './rose-pine-dawn.css?raw'

export const BUILTIN_THEMES: Record<string, string> = {
  dark,
  light,
  'rose-pine': rosePine,
  'rose-pine-moon': rosePineMoon,
  'rose-pine-dawn': rosePineDawn,
}
