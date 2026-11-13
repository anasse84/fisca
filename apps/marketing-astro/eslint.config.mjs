import rootConfig from '../../eslint.config.mjs';

export default [
  { ignores: ['.astro/**', '.wrangler/**'] },
  ...rootConfig,
];
