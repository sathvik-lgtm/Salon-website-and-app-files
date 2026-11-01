import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every staff page is dynamic and private (never cached), so no incremental cache is needed.
export default defineCloudflareConfig();
