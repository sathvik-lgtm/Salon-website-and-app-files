import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Incremental cache (R2/KV) is added in M3 when ISR pages exist.
export default defineCloudflareConfig();
