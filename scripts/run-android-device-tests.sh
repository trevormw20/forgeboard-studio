#!/usr/bin/env bash
# Preserve native screenshots even if a test fails. Run from the repository root.
set -u
gradle --no-daemon -p android connectedDebugAndroidTest
test_result=$?
mkdir -p android-device-evidence
adb pull /data/local/tmp/forgeboard-qa android-device-evidence/ || true
exit "$test_result"
