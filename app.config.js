const { expo } = require('./app.json');

/**
 * App Store / TestFlight 版と、端末へ直接入れる開発版を同じiPhoneに
 * 共存させるためのアプリバリアント設定。
 */
const isDevelopmentVariant = process.env.APP_VARIANT === 'development';
const iosBuildNumber = process.env.IOS_BUILD_NUMBER;

module.exports = {
  ...expo,
  version: '1.0.1',
  name: isDevelopmentVariant ? 'オオサンショウウオ育成（開発）' : expo.name,
  ios: {
    ...expo.ios,
    ...(iosBuildNumber ? { buildNumber: iosBuildNumber } : {}),
    bundleIdentifier: isDevelopmentVariant
      ? 'com.oosanriver.app.dev'
      : expo.ios.bundleIdentifier,
  },
  android: {
    ...expo.android,
    package: isDevelopmentVariant
      ? 'com.oosanriver.app.dev'
      : expo.android.package,
  },
};
