# Bilal Drive Man — Project Context

## Tech Stack
- Framework: Next.js (Pages Router) with getServerSideProps for SSR
- Language: JavaScript (no TypeScript)
- Styling: Plain CSS in styles/globals.css — no Tailwind, no CSS modules
- Database: Supabase PostgreSQL via REST API (lib/supabase.js)
- Auth: bcrypt + HMAC session tokens (lib/auth.js)
- Deployment: Vercel (auto-deploys from GitHub main branch)
- Scanners: Python scripts on Mac (LaunchAgent) and Windows (system tray)

## Folder Structure
- /pages           Next.js pages and API routes
- /pages/api       All backend endpoints
- /components      React components (one per page: DrivesPage, DevicesPage, etc.)
- /lib             Shared utilities (supabase.js, auth.js, format.js)
- /styles          globals.css — single CSS file for all styling
- /mac-scanner     Mac scanner Python script (synced to GitHub for auto-update)
- /windows-scanner Windows scanner Python script

## Build Commands
- `npm run dev`    Start dev server on port 3000
- `npm run build`  Production build (verify before pushing)

## Key Patterns
- All Supabase queries go through lib/supabase.js — never hardcode keys elsewhere
- API routes use requireAuth (dashboard) or requireApiKey (scanner endpoints)
- Scanner API key: x-api-key header validated in lib/auth.js
- Accent color: #c8e600 (green), Dark: #1a1a2e, Background: #f4f5f7
- CSS class naming: page-prefix pattern (dp- for downloading-pro, device- for devices)
- Responsive breakpoints: 480px, 768px, 1024px, 1200px, 1440px, 1920px

## Scanner Files — IMPORTANT
- After editing scanner Python files, MUST copy to BOTH locations:
  - Working copy: /mac-scanner/ or /windows-scanner/ (outside web-app)
  - Git repo: web-app/mac-scanner/ or web-app/windows-scanner/
- Scanners auto-update from GitHub raw URL every 5min (Mac) / 60s (Windows)
- Bump VERSION string when changing scanner code

## Conventions
- NEVER expose Supabase keys in client-side code
- NEVER remove the hardcoded fallback key in lib/supabase.js
- All API errors return generic messages — never expose err.message to client
- Sanitize all string inputs with sanitizeString from lib/auth.js
- Filter out temp volumes (msu-target-*, fcpx-*) in both scanner and dashboard
- Login rate limiting is DISABLED per user request — do not re-enable
