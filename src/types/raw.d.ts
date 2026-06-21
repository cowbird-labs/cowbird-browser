// Vite/wxt support importing a file's raw text with the `?raw` suffix. Declare
// the module shape so TypeScript accepts these imports (e.g. the EFF wordlist).
declare module '*?raw' {
  const content: string;
  export default content;
}
