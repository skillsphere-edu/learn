/**
 * SkillSphere Edu — Service Worker
 * Strategy:
 *   - Static assets (fonts, CSS, icons) → Cache First
 *   - LMS HTML pages → Network First with offline fallback
 *   - Firebase / Razorpay API → Network Only (never cache auth/payment)
 *   - YouTube embeds → Network Only
 *
 * Bump CACHE_VERSION whenever you deploy significant changes
 * so old caches are purged automatically.
 */

const CACHE_VERSION  = 'sse-lms-v1';
const STATIC_CACHE   = `${CACHE_VERSION}-static`;
const PAGES_CACHE    = `${CACHE_VERSION}-pages`;
const ALL_CACHES     = [STATIC_CACHE, PAGES_CACHE];

/* ── Assets to pre-cache on install ── */
const STATIC_ASSETS = [
  '/learn/assets/logotp.png',
  '/learn/assets/favicon-32x32.png',
  '/learn/assets/favicon-180x180.png',
  '/learn/lms/manifest.json',
  /* Google Fonts are handled dynamically; listed here for reference only */
];

/* ── LMS pages to cache after first visit ── */
const LMS_PAGES = [
  '/learn/lms/login.html',
  '/learn/lms/dashboard.html',
  '/learn/lms/player.html',
  '/learn/lms/profile.html',
  '/learn/lms/leaderboard.html',
  '/learn/lms/admin.html',
];

/* ── Offline fallback page ── */
const OFFLINE_PAGE = '/learn/lms/offline.html';

/* ─────────────────────────────────────────────
   INSTALL — pre-cache static assets
───────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      /* Non-failing: skip assets that 404 on first deploy */
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => { /* asset not yet available, skip */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─────────────────────────────────────────────
   ACTIVATE — purge old caches
───────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─────────────────────────────────────────────
   FETCH — routing logic
───────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Never intercept non-GET requests (POST, PUT, DELETE) */
  if (request.method !== 'GET') return;

  /* 2. Never cache Firebase, Razorpay, YouTube, or Google Tag Manager */
  const NETWORK_ONLY_ORIGINS = [
    'firebaseinstallations.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firestore.googleapis.com',
    'googleapis.com',
    'firebase.googleapis.com',
    'razorpay.com',
    'youtube.com',
    'youtu.be',
    'ytimg.com',
    'googlevideo.com',
    'googletagmanager.com',
    'google-analytics.com',
    'gstatic.com'        /* Firebase + Google SDK CDN — always fresh */
  ];

  if (NETWORK_ONLY_ORIGINS.some((origin) => url.hostname.includes(origin))) {
    return; /* Fall through to browser — network only */
  }

  /* 3. LMS HTML pages — Network First with cache fallback */
  if (LMS_PAGES.some((page) => url.pathname === page || url.pathname.endsWith(page))) {
    event.respondWith(networkFirstWithFallback(request, PAGES_CACHE));
    return;
  }

  /* 4. Static assets (images, fonts from fonts.googleapis.com/fonts.gstatic.com) */
  if (
    request.destination === 'image'  ||
    request.destination === 'font'   ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirstWithNetworkFallback(request, STATIC_CACHE));
    return;
  }

  /* 5. HTML navigation requests (other pages on the site) — Network First */
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request, PAGES_CACHE));
    return;
  }

  /* 6. Everything else — network only (don't cache JS/CSS from CDNs blindly) */
});

/* ─────────────────────────────────────────────
   STRATEGY: Network First → Cache → Offline page
───────────────────────────────────────────── */
async function networkFirstWithFallback(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone()); /* Update cache in background */
    }
    return networkResponse;
  } catch (_) {
    /* Network failed — try cache */
    const cached = await caches.match(request);
    if (cached) return cached;

    /* No cache either — return offline page for navigation */
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match(OFFLINE_PAGE);
      if (offlinePage) return offlinePage;
      /* Last resort inline offline response */
      return new Response(offlineHTML(), {
        status:  200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return new Response('', { status: 503 });
  }
}

/* ─────────────────────────────────────────────
   STRATEGY: Cache First → Network → Cache store
───────────────────────────────────────────── */
async function cacheFirstWithNetworkFallback(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    return new Response('', { status: 503 });
  }
}

/* ─────────────────────────────────────────────
   INLINE OFFLINE PAGE (fallback when offline.html not cached)
───────────────────────────────────────────── */
function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline | SkillSphere Edu</title>
  <style>
    :root { --paper:#f0ead6; --ink:#1a1209; --red:#c0272d; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      background:var(--paper); color:var(--ink);
      font-family:'Courier New',monospace;
      min-height:100vh; display:flex; flex-direction:column;
      align-items:center; justify-content:center; text-align:center; padding:2rem;
    }
    .case-tag { font-size:11px; letter-spacing:5px; color:var(--red); text-transform:uppercase; margin-bottom:1rem; }
    h1 { font-family:serif; font-size:clamp(3rem,8vw,6rem); letter-spacing:2px; color:var(--ink); line-height:1; margin-bottom:0.5rem; }
    p { font-size:0.9rem; color:#6b5f45; max-width:340px; line-height:1.7; margin-bottom:2rem; }
    a { display:inline-block; padding:0.75rem 1.8rem; background:var(--red); color:#fff; font-size:0.75rem; letter-spacing:3px; text-transform:uppercase; text-decoration:none; border-radius:3px; }
    .icon { font-size:4rem; margin-bottom:1.5rem; }
  </style>
</head>
<body>
  <div class="icon">📡</div>
  <div class="case-tag">Connection Lost · Offline</div>
  <h1>No Signal</h1>
  <p>You appear to be offline. Please check your internet connection and try again. Your progress is saved.</p>
  <a href="javascript:location.reload()">Retry Connection →</a>
</body>
</html>`;
}

/* ─────────────────────────────────────────────
   BACKGROUND SYNC — retry failed progress saves
   (Fires when connectivity is restored)
───────────────────────────────────────────── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-progress') {
    event.waitUntil(syncPendingProgress());
  }
});

async function syncPendingProgress() {
  /* Progress saves are handled directly by Firebase SDK which has its own
     offline queue. This sync event is a safety net for any custom queued ops. */
  const allClients = await self.clients.matchAll();
  allClients.forEach((client) => {
    client.postMessage({ type: 'SYNC_COMPLETE' });
  });
}

/* ─────────────────────────────────────────────
   PUSH NOTIFICATIONS (future-ready, not yet wired to backend)
   When you add EmailJS or Firebase Cloud Messaging, uncomment + configure.
───────────────────────────────────────────── */
/*
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'SkillSphere Edu', {
      body:  data.body  || 'You have a new notification.',
      icon:  '/learn/assets/icon-192x192.png',
      badge: '/learn/assets/favicon-32x32.png',
      data:  { url: data.url || '/learn/lms/dashboard.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/learn/lms/dashboard.html')
  );
});
*/
