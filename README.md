# BSP Plate Loading System
**Bhilai Steel Plant — Plate Mill Loading Management**

Enterprise-grade React web application for managing the plate loading process at BSP's Plate Mill.

---

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

**Login credentials:** `admin` / `admin`

---

## Project Structure

```
src/
├── api/
│   └── index.js          # All API calls + mock adapters
├── context/
│   ├── AuthContext.jsx   # Authentication (swap strategy here)
│   └── ToastContext.jsx  # Global toast notifications
├── utils/
│   └── export.js         # JSON export + PDF generation
├── components/
│   ├── layout/
│   │   └── AppShell.jsx  # Sidebar + topbar layout
│   └── shared/
│       └── Modal.jsx     # Reusable modal
└── pages/
    ├── LoginPage.jsx
    ├── RakeGenerationPage.jsx
    ├── LoadingOperationsPage.jsx
    └── LoadingReportPage.jsx
```

---

## Real API Integration

The app currently uses these **live** BSP APIs:
- **Destinations:** `https://bspapp.sail-bhilaisteel.com/MES_MOB/APP/destData.jsp`
- **Consignees:** `https://bspapp.sail-bhilaisteel.com/MES_MOB/APP/plateConsgn.jsp?dest_cd={CODE}`

These are proxied through Vite dev server to avoid CORS issues (`/api-proxy/...`).

### Mock APIs (pending backend)
In `src/api/index.js`, set `USE_MOCK` flags:

```js
const USE_MOCK = {
  destinations: false,  // Real API ✓
  consignees:   false,  // Real API ✓
  rake:         true,   // Mock — awaiting backend
  submitLoad:   true,   // Mock — awaiting backend
}
```

When the real Rake and Submit APIs are ready:
1. Set the corresponding flag to `false`
2. Fill in the real endpoint URLs in the commented sections

---

## Switching Auth Strategy

In `src/context/AuthContext.jsx`, replace the `authStrategy` object:

```js
// Example: JWT API auth
const authStrategy = {
  async authenticate(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (res.ok) return { ok: true, user: data.user, error: null }
    return { ok: false, user: null, error: data.message }
  },
  logout() {
    // Optional: call /api/auth/logout
  }
}
```

---

## Final Submission

When the `submitLoad` backend API is ready:
1. Set `USE_MOCK.submitLoad = false` in `src/api/index.js`
2. Fill in the real endpoint URL
3. The JSON payload structure is defined in `src/utils/export.js` → `buildSubmitPayload()`

Until then, use **Export JSON** to download the payload and **Download PDF** for the loading report.

---

## Production Build

```bash
npm run build
# Output in /dist — deploy to any static host or BSP intranet server
```

For production, update `vite.config.js` to proxy to the production BSP API host, or configure your reverse proxy (Nginx, Apache) to handle CORS.
