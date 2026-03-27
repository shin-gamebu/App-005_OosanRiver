import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { AppState } from './logic';
import { backgroundGaugeDecayMultiplier } from './logic';

const CHANNEL_CARE = 'care-gauge-alerts';

let handlerRegistered = false;
let scheduledFullnessAlertId: string | null = null;
let scheduledViscosityAlertId: string | null = null;

function registerHandler(): void {
  if (Platform.OS === 'web' || handlerRegistered) return;
  handlerRegistered = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_CARE, {
    name: 'おなか・ヌメリ',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#4a90a4',
  });
}

async function cancelPredictiveSchedules(): Promise<void> {
  if (scheduledFullnessAlertId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(scheduledFullnessAlertId);
    } catch {
      /* noop */
    }
    scheduledFullnessAlertId = null;
  }
  if (scheduledViscosityAlertId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(scheduledViscosityAlertId);
    } catch {
      /* noop */
    }
    scheduledViscosityAlertId = null;
  }
}

function estimateSecondsToZero(
  pct: number,
  decayPerSecondBase: number,
  state: AppState,
  atMs: number
): number | null {
  if (pct <= 0 || state.condition === 'dead') return null;
  const bgm = backgroundGaugeDecayMultiplier(state, atMs);
  const rate = decayPerSecondBase * bgm * 0.9;
  if (rate <= 0) return null;
  const sec = Math.ceil(pct / rate);
  if (sec < 5) return 5;
  if (sec > 3600 * 24 * 14) return null;
  return sec;
}

/** 起動時: チャネル・通知許可（ロック画面／通知センター用） */
export async function prepareCareGaugeNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  registerHandler();
  await ensureAndroidChannel();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

/**
 * ホーム切り替え・画面オフ時に OS が配信する「予約通知」。
 * アプリが止まっていても、おおよその 0% 到達時刻にロック画面へ届く。
 */
export async function schedulePredictiveGaugeAlerts(
  state: AppState,
  atMs: number,
  fullnessDecayPerSecond: number,
  viscosityDecayPerSecond: number
): Promise<void> {
  if (Platform.OS === 'web') return;
  registerHandler();
  await ensureAndroidChannel();
  await cancelPredictiveSchedules();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  const fSec = estimateSecondsToZero(
    state.fullness,
    fullnessDecayPerSecond,
    state,
    atMs
  );
  const vSec = estimateSecondsToZero(
    state.viscosity,
    viscosityDecayPerSecond,
    state,
    atMs
  );

  const triggerFull =
    fSec != null
      ? ({
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: fSec,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
        } as const)
      : null;

  const triggerVis =
    vSec != null
      ? ({
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(5, vSec + (vSec === fSec ? 3 : 0)),
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
        } as const)
      : null;

  try {
    if (triggerFull) {
      scheduledFullnessAlertId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'おなかがすきました',
          body: 'オオサンショウウオにエサ（Feed）をあげましょう。',
          data: { type: 'fullness_empty_scheduled' },
          sound: true,
        },
        trigger: triggerFull,
      });
    }
    if (triggerVis) {
      scheduledViscosityAlertId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'ヌメリがかわきました',
          body: 'Water でヌメリを補給しましょう。',
          data: { type: 'viscosity_empty_scheduled' },
          sound: true,
        },
        trigger: triggerVis,
      });
    }
  } catch (e) {
    console.warn('schedulePredictiveGaugeAlerts:', e);
  }
}

/** フォアグラウンド復帰時: 古い予約を消す（既に回復していても鳴らないように） */
export async function clearPredictiveGaugeAlerts(): Promise<void> {
  await cancelPredictiveSchedules();
}

export async function notifyFullnessEmptyNow(): Promise<void> {
  await sendImmediateNotification(
    'おなかがすきました',
    'オオサンショウウオにエサ（Feed）をあげましょう。',
    'fullness_empty'
  );
}

export async function notifyViscosityEmptyNow(): Promise<void> {
  await sendImmediateNotification(
    'ヌメリがかわきました',
    'Water でヌメリを補給しましょう。',
    'viscosity_empty'
  );
}

async function sendImmediateNotification(
  title: string,
  body: string,
  dataType: string
): Promise<void> {
  if (Platform.OS === 'web') return;
  registerHandler();
  await ensureAndroidChannel();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { type: dataType },
        sound: true,
      },
      trigger:
        Platform.OS === 'android'
          ? { channelId: CHANNEL_CARE }
          : null,
    });
  } catch (e) {
    console.warn('sendImmediateNotification:', e);
  }
}
