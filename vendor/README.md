# Vendored libraries

These are unmodified UMD builds, committed so the app has no runtime CDN
dependency and works offline / behind restrictive networks.

| File | Package | Version | Source |
| --- | --- | --- | --- |
| `supabase.js` + `591.supabase.js` | `@supabase/supabase-js` | 2.45.4 | npm (MIT) |
| `lucide.min.js` | `lucide` | 0.454.0 | npm (ISC) |

`591.supabase.js` is a Node-only `ws` stub that browsers never request; it is
kept beside `supabase.js` only so webpack path resolution stays correct.

To update: download the version's tarball from the npm registry and replace
these files with its `dist/umd/*` builds.
