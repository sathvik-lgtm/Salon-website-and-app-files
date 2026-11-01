import { brand } from '@salon/config/brand';
import type { MetadataRoute } from 'next';

/**
 * Makes the staff app installable on a tablet or desktop (Chrome: "Install"). It is served under
 * /admin, so the scope and every address include that prefix. Booking needs a connection: there is
 * no offline mode in v0.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/admin',
    name: `${brand.name} Staff`,
    short_name: 'Salon Staff',
    description: 'Bookings and schedule for the team.',
    start_url: '/admin',
    scope: '/admin/',
    display: 'standalone',
    background_color: '#fbfaf8',
    theme_color: '#9f3b4f',
    icons: [
      { src: '/admin/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/admin/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/admin/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
