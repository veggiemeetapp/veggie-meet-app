#!/usr/bin/env bash
# WO-041 Production Build Verification
# Exits non-zero on any failure. Never echoes secrets.
set -u
fail=0
step() { echo; echo "===> $*"; }
fail() { echo "FAIL: $*"; fail=1; }

step "1. Typecheck"
if command -v tsgo >/dev/null 2>&1; then
  tsgo || fail "typecheck failed"
else
  npx --yes -p typescript tsc --noEmit || fail "typecheck failed"
fi

step "2. Production build"
rm -rf dist
if command -v bun >/dev/null 2>&1; then
  bun run build || fail "build failed"
else
  npm run build || fail "build failed"
fi

step "3. Bundle-size extraction"
if [ -d dist ]; then
  find dist -name '*.js' -printf '%s %p\n' | sort -rn | head -20
  total=$(du -sb dist | awk '{print $1}')
  echo "dist total bytes: $total"
else
  fail "no dist/ produced"
fi

step "4. Route chunk listing"
find dist -name '*.js' | sort

step "5. QR-scanner lazy chunk verification"
qr_chunks=$(grep -rIl "html5-qrcode\|Html5Qrcode" dist/ 2>/dev/null | grep -v index || true)
if [ -z "$qr_chunks" ]; then
  fail "no lazy QR chunk found (Check-In / Place-Check-In must be lazy)"
else
  # Ensure QR code is NOT in the initial entry chunk
  entry=$(grep -l 'createRoot\|ReactDOM' dist/assets/*.js 2>/dev/null | head -1)
  if [ -n "$entry" ] && grep -q "html5-qrcode\|Html5Qrcode" "$entry"; then
    fail "QR scanner leaked into entry chunk: $entry"
  else
    echo "QR chunk(s): $qr_chunks"
  fi
fi

step "6. Secret scan"
if grep -rIn "SUPABASE_SERVICE_ROLE\|sb_secret_[A-Za-z0-9_-]\{8,\}\|-----BEGIN [A-Z ]*PRIVATE KEY-----" dist/ 2>/dev/null | grep -v Binary; then
  fail "secret material detected in dist/"
fi

step "7. Preview-project reference scan"
if grep -rIn "zllamljlygjkknsguuki\|sb_publishable_8GBBSf4Dcm1n49Akt7dHSw" dist/ .env 2>/dev/null | grep -v Binary; then
  fail "preview project reference detected — production build must not include preview keys/URL"
fi

step "8. QA-pattern scan"
if grep -rIn "__QA__\|VITE_QA\b\|WO041_SMOKE_" dist/ 2>/dev/null | grep -v Binary; then
  fail "QA-only marker detected in dist/"
fi

step "9. Source-map policy"
maps=$(find dist -name '*.map' 2>/dev/null | wc -l)
if [ "$maps" -gt 0 ]; then
  echo "WARN: $maps source map(s) present. If policy disables source maps in production, this must be zero."
fi

step "10. Missing-asset check"
for f in dist/index.html; do
  [ -f "$f" ] || fail "$f missing"
done

echo
if [ $fail -eq 0 ]; then
  echo "PRODUCTION BUILD VERIFICATION: PASS"
  exit 0
else
  echo "PRODUCTION BUILD VERIFICATION: FAIL"
  exit 1
fi
