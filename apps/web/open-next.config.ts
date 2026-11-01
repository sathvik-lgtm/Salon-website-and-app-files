import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// The content pages are prerendered at build time and never revalidated (a content change means a
// redeploy), so the read-only static-assets cache is all we need: no R2, KV, queue or tag cache.
// If pages ever need time-based refresh (ISR), switch to the R2 cache + DO queue per the OpenNext docs.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
