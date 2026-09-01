/**
 * Remove Electron's generic macOS capability copy from Scriptum's package.
 *
 * Electron ships broad usage-description strings because it supports apps
 * that capture media or use Bluetooth. Scriptum does none of those things and
 * denies all permission requests at runtime, so keeping the strings would be
 * misleading. The hook also makes App Transport Security deny network loads;
 * the main process request filter remains the cross-platform enforcement layer.
 */

const fs = require('node:fs');
const path = require('node:path');

const UNUSED_CAPABILITY_KEYS = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

function hardenInfo(info) {
  const hardened = { ...info };
  for (const key of UNUSED_CAPABILITY_KEYS) delete hardened[key];
  hardened.NSAppTransportSecurity = {
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: false,
  };
  return hardened;
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const plist = await import('plist');
  const appName = context.packager.appInfo.productFilename;
  const infoPath = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist');
  const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
  fs.writeFileSync(infoPath, plist.build(hardenInfo(info)), 'utf8');
}

module.exports = afterPack;
module.exports.hardenInfo = hardenInfo;
