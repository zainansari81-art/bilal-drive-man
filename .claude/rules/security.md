## Security Rules
- All dashboard API routes MUST use requireAuth middleware
- All scanner API routes MUST use requireApiKey middleware
- NEVER hardcode credentials in components or pages — only in lib/auth.js
- NEVER commit .env files with real values
- Sanitize all user inputs with sanitizeString before database queries
- PostgREST injection prevention: strip special chars from search queries
- Session tokens: 24-hour expiry, HMAC-SHA256 signed, HttpOnly Secure cookies
- API key rate limiting: 60 requests/minute (active)
- Generic error messages only — never leak internal errors to clients
