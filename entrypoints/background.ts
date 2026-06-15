import { defineBackground } from 'wxt/utils/define-background';
import { startBackground } from '../src/background/index';

export default defineBackground(() => {
  startBackground();
});
