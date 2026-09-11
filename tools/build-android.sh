#!/usr/bin/env bash
# Builds a signed release APK for arm64 Android 16+ devices.
#
#   ./tools/build-android.sh
#
# Environment:
#   JAVA_HOME        JDK 17
#   ANDROID_HOME     Android SDK with platform 36 and build-tools 36.0.0
#   NIMTZY_KEYSTORE  path to the release keystore (defaults to ./nimtzy-release.keystore)
#   NIMTZY_PASSWORD  keystore and key password (defaults to the development value)
#
# Generate your own keystore for anything you publish:
#   keytool -genkeypair -v -keystore nimtzy-release.keystore -alias nimtzy \
#     -keyalg RSA -keysize 4096 -validity 10950

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-$HOME/toolchain/jdk-17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

# Metro warns and falls back when NODE_ENV is unset; a release bundle must be
# built in production mode.
export NODE_ENV=production

KEYSTORE="${NIMTZY_KEYSTORE:-$ROOT/nimtzy-release.keystore}"
PASSWORD="${NIMTZY_PASSWORD:-nimtzyagent}"

if [ ! -f "$KEYSTORE" ]; then
  echo "Keystore not found at $KEYSTORE" >&2
  exit 1
fi

echo "== Generating the native project =="
npx expo prebuild --platform android --no-install

echo "== Building the release APK for arm64-v8a =="
cd android
ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a \
ORG_GRADLE_PROJECT_NIMTZY_STORE_FILE="$KEYSTORE" \
ORG_GRADLE_PROJECT_NIMTZY_STORE_PASSWORD="$PASSWORD" \
ORG_GRADLE_PROJECT_NIMTZY_KEY_ALIAS=nimtzy \
ORG_GRADLE_PROJECT_NIMTZY_KEY_PASSWORD="$PASSWORD" \
  ./gradlew assembleRelease -x lint -x test

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK" ]; then
  # The native folder is generated and gitignored, so a copy is kept where a
  # clean checkout cannot wipe it.
  VERSION="$(node -p "require('$ROOT/app.json').expo.version")"
  OUT="$ROOT/dist/nimtzyagent-$VERSION-arm64.apk"
  mkdir -p "$ROOT/dist"
  cp "$APK" "$OUT"

  echo
  echo "APK:      $OUT"
  echo "Size:     $(du -h "$OUT" | cut -f1)"
  echo "SHA-256:  $(sha256sum "$OUT" | cut -d' ' -f1)"
  "$ANDROID_HOME"/build-tools/36.0.0/apksigner verify --print-certs "$OUT" | head -5
fi
