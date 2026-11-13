import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://fisca.ma',
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  trailingSlash: 'ignore',
});
