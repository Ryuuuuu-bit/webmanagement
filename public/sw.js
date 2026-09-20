// Service worker: (1) exists with a fetch handler so Chrome/Android treat the
// site as installable; does no caching so it never serves stale content.
// (2) Web Push: shows the notification the server sent and opens the right
// page when tapped.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let data = { title: "TeachSchedule", body: "", href: "/notifications", tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon",
      badge: "/icon",
      tag: data.tag,
      data: { href: data.href || "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/notifications";
  const url = new URL(href, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => c.url && c.url.startsWith(self.location.origin)) || list[0];
      if (client && "focus" in client) {
        return client
          .focus()
          .then(() => ("navigate" in client ? client.navigate(url) : null))
          .catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    })
  );
});
