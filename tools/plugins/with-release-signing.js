const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Adds a release signing config driven by Gradle properties, so a locally built
 * APK is signed with a real key instead of the debug one. Values come from
 * `-P` flags or ORG_GRADLE_PROJECT_* environment variables:
 *
 *   NIMTZY_STORE_FILE, NIMTZY_STORE_PASSWORD, NIMTZY_KEY_ALIAS, NIMTZY_KEY_PASSWORD
 *
 * With no store file set it falls back to the debug keystore, which keeps
 * `assembleRelease` runnable without credentials. EAS Build manages its own
 * credentials and does not read any of this.
 */
const SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (findProperty('NIMTZY_STORE_FILE')) {
                storeFile file(findProperty('NIMTZY_STORE_FILE'))
                storePassword findProperty('NIMTZY_STORE_PASSWORD')
                keyAlias findProperty('NIMTZY_KEY_ALIAS')
                keyPassword findProperty('NIMTZY_KEY_PASSWORD')
            } else {
                // No key supplied: sign with the debug keystore so the build
                // still completes. Never distribute an APK built this way.
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }`;

const DEFAULT_SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') return gradleConfig;

    let contents = gradleConfig.modResults.contents;

    if (!contents.includes(DEFAULT_SIGNING_CONFIGS)) {
      throw new Error(
        'with-release-signing: the signingConfigs block in android/app/build.gradle does not match the expected shape.',
      );
    }
    contents = contents.replace(DEFAULT_SIGNING_CONFIGS, SIGNING_CONFIGS);

    // Scoped to the buildTypes block: the signingConfigs block above it also
    // contains a `release {`, and the debug build type carries the same
    // signingConfig line that must be left alone.
    const buildTypesIndex = contents.indexOf('buildTypes {');
    if (buildTypesIndex < 0) {
      throw new Error('with-release-signing: no buildTypes block in android/app/build.gradle.');
    }
    const head = contents.slice(0, buildTypesIndex);
    const tail = contents.slice(buildTypesIndex);
    const releaseBuildType = /release \{[\s\S]*?signingConfig signingConfigs\.debug/;
    if (!releaseBuildType.test(tail)) {
      throw new Error(
        'with-release-signing: could not find the release build type signingConfig line.',
      );
    }
    contents =
      head +
      tail.replace(releaseBuildType, (match) =>
        match.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release'),
      );

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
};
