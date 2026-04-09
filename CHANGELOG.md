# Changelog

## [2026-04-09]
- fix(deploy): trigger Netlify redeploy to sync main branch — resolves umami script stale deploy (bug-006 / 86agdabwd)
  - Live site was serving commit 1cf5d8c (placeholder umami script: your-umami.vercel.app)
  - Repo main is at a44b395 (correct script: cloud.umami.is, shared ID 5c935661, data-tag="alpha")
  - No code changes — deploy trigger only

## [2026-03-31]
- feat: align .me with .com theme + apply Claude advisement (a44b395)

## [2026-03-30]
- Update og-image.png with canvas-rendered HTML animation screenshot (c1a553c)

## [2026-03-29]
- Add OG image, favicon, and apple-touch-icon for PageForward Airways (1231070)

## [2026-03-28]
- fix: SEO, accessibility, and social meta issues — isreadyforlaunch audit (fbc1051)

## [2026-03-24]
- fix(analytics): swap Umami placeholder with shared .com ID scoped to .me — closes BUG-010 (3440b83)

## [2026-03-20]
- Implement boarding flow: copy, /boarding function, Supabase DDL (c57d151)

## [2026-02-25]
- Add Umami analytics script + data-umami-event to beta access submit button (1cf5d8c)

## [2026-02-24]
- Upgrade .me to QA/beta recruitment funnel with Netlify form, validation, success state (d74c035)
