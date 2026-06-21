/* EVA service worker — Workbox precache + offline shell + web push */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    request.method === 'GET' &&
    !url.pathname.startsWith('/api/') &&
    (request.destination === 'image' || request.destination === 'font'),
  new CacheFirst({ cacheName: 'eva-static-v2' })
);

registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    request.method === 'GET' &&
    url.pathname.startsWith('/assets/'),
  new CacheFirst({ cacheName: 'eva-assets-v2' })
);

registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'eva-pages-v2',
      networkTimeoutSeconds: 4,
      plugins: [
        {
          handlerDidError: async () =>
            (await caches.match('/offline.html')) ||
            (await caches.match('/index.html')) ||
            Response.error(),
        },
      ],
    })
  )
);

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'EVA';
  const opts = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data.data || {},
    tag: data.tag || 'eva-notification',
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/';
  const fullUrl = new URL(path, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          client.navigate(fullUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(fullUrl);
    })
  );
});
