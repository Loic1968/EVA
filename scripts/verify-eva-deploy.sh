#!/usr/bin/env bash
# Mandatory post-deploy regression checks for EVA (Render / production).
# Exit non-zero on any failure.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${EVA_API_BASE:-https://eva.halisoft.biz}"
FAIL=0
PASSED=0
FAILED=0

pass() { echo "  ✓ $*"; PASSED=$((PASSED + 1)); }
fail() { echo "  ✗ $*"; FAIL=1; FAILED=$((FAILED + 1)); }

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$1" 2>/dev/null || echo "000"
}

echo "==> EVA deploy verification"
echo "    Base: ${BASE}"
echo ""

echo "── [1/3] Build"
cd "${REPO_DIR}"
if npm run build >/tmp/eva-verify-build.log 2>&1; then
  pass "npm run build"
else
  fail "npm run build (see /tmp/eva-verify-build.log)"
  tail -20 /tmp/eva-verify-build.log | sed 's/^/      /'
fi

echo ""
echo "── [2/3] Mobile PWA"
MOBILE_CODE="$(http_code "${BASE}/mobile")"
if [[ "${MOBILE_CODE}" == "200" ]]; then
  pass "GET /mobile → 200"
else
  fail "GET /mobile → ${MOBILE_CODE} (expected 200)"
fi

echo ""
echo "── [3/3] Health API"
HEALTH_CODE="$(http_code "${BASE}/health")"
API_HEALTH_CODE="$(http_code "${BASE}/api/health")"
if [[ "${HEALTH_CODE}" == "200" ]]; then
  pass "GET /health → 200"
elif [[ "${API_HEALTH_CODE}" == "200" ]]; then
  pass "GET /api/health → 200"
else
  fail "GET /health → ${HEALTH_CODE}, /api/health → ${API_HEALTH_CODE} (expected 200)"
fi

echo ""
if [[ "${FAIL}" -eq 0 ]]; then
  echo "✅ EVA deploy verification PASSED (${PASSED} checks)"
  exit 0
else
  echo "❌ EVA deploy verification FAILED (${FAILED} failed, ${PASSED} passed)"
  exit 1
fi
