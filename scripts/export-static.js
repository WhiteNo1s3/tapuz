'use strict';

// npm run export:static — regenerate the static site (public/*.html) from the
// current db. A file instead of an inline `node -e` one-liner: npm runs
// scripts through cmd.exe on Windows, which keeps single quotes, so the old
// quoted expression evaluated as a bare string literal — a silent no-op.
require('../src/export').exportAll();
