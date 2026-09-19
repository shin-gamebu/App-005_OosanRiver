import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppState } from './logic';
import {
  backgroundGaugeDecayMultiplier,
  DAYS_UNTIL_DEATH,
  DAYS_UNTIL_INACTIVITY_REMINDER,
} from './logic';

const CHANNEL_CARE = 'care-gauge-alerts';
const CARE_NOTIFICATION_ID_KEY = 'oosanRiverCareNotificationId';
const CARE_REMINDER_NOTIFICATION_ID_KEY = 'oosanRiverCareReminderNotificationId';
const CARE_FOLLOW_UP_NOTIFICATION_ID_KEY = 'oosanRiverCareFollowUpNotificationId';
const INACTIVITY_NOTIFICATION_ID_KEY = 'oosanRiverInactivityNotificationId';
const THIRTY_DAY_NOTIFICATION_ID_KEY = 'oosanRiverThirtyDayNotificationId';

let handlerRegistered = false;
let scheduledCareInitialAlertId: string | null = null;
let scheduledCareReminderAlertId: string | null = null;
let scheduledCareFollowUpAlertId: string | null = null;
let scheduledInactivityAlertId: string | null = null;
let scheduledThirtyDayAlertId: string | null = null;

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
    name: '育成のお知らせ',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#4a90a4',
  });
}

async function cancelPredictiveSchedules(): Promise<void> {
  const initialCareId = scheduledCareInitialAlertId ?? (await AsyncStorage.getItem(CARE_NOTIFICATION_ID_KEY));
  if (initialCareId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(initialCareId);
    } catch {
      /* noop */
    }
  }
  const reminderCareId = scheduledCareReminderAlertId ?? (await AsyncStorage.getItem(CARE_REMINDER_NOTIFICATION_ID_KEY));
  if (reminderCareId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(reminderCareId);
    } catch {
      /* noop */
    }
  }
  const followUpCareId = scheduledCareFollowUpAlertId ?? (await AsyncStorage.getItem(CARE_FOLLOW_UP_NOTIFICATION_ID_KEY));
  if (followUpCareId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(followUpCareId);
    } catch {
      /* noop */
    }
  }
  scheduledCareInitialAlertId = null;
  scheduledCareReminderAlertId = null;
  scheduledCareFollowUpAlertId = null;
  await AsyncStorage.removeItem(CARE_NOTIFICATION_ID_KEY);
  await AsyncStorage.removeItem(CARE_REMINDER_NOTIFICATION_ID_KEY);
  await AsyncStorage.removeItem(CARE_FOLLOW_UP_NOTIFICATION_ID_KEY);
  const inactivityId =
    scheduledInactivityAlertId ?? (await AsyncStorage.getItem(INACTIVITY_NOTIFICATION_ID_KEY));
  if (inactivityId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(inactivityId);
    } catch {
      /* すでに配信済み・削除済みの場合もある */
    }
  }
  scheduledInactivityAlertId = null;
  await AsyncStorage.removeItem(INACTIVITY_NOTIFICATION_ID_KEY);

  const thirtyDayId =
    scheduledThirtyDayAlertId ?? (await AsyncStorage.getItem(THIRTY_DAY_NOTIFICATION_ID_KEY));
  if (thirtyDayId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(thirtyDayId);
    } catch {
      /* すでに配信済み・削除済みの場合もある */
    }
  }
  scheduledThirtyDayAlertId = null;
  await AsyncStorage.removeItem(THIRTY_DAY_NOTIFICATION_ID_KEY);
}

/** 最後に開いたあと14日経過した頃に、再訪を促す通知を予約する。 */
async function scheduleInactivityReminder(): Promise<void> {
  const seconds = DAYS_UNTIL_INACTIVITY_REMINDER * 24 * 60 * 60;
  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds,
    ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
  } as const;
  scheduledInactivityAlertId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'しばらく会えていません',
      body: 'オオサンショウウオが弱っています。会いにいきましょう。',
      data: { type: 'inactivity_reminder' },
      sound: true,
    },
    trigger,
  });
  await AsyncStorage.setItem(INACTIVITY_NOTIFICATION_ID_KEY, scheduledInactivityAlertId);
}

/** 最後に開いたあと30日経過した頃に、最終の再訪通知を予約する。 */
async function scheduleThirtyDayReminder(): Promise<void> {
  const seconds = DAYS_UNTIL_DEATH * 24 * 60 * 60;
  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds,
    ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
  } as const;
  scheduledThirtyDayAlertId = await Notifications.scheduleNotificationAsync({
    content: {
      title: '30日間会えていません',
      body: 'オオサンショウウオが、静かに旅立とうとしています。会いにいきましょう。',
      data: { type: 'thirty_day_reminder' },
      sound: true,
    },
    trigger,
  });
  await AsyncStorage.setItem(THIRTY_DAY_NOTIFICATION_ID_KEY, scheduledThirtyDayAlertId);
}

function estimateSecondsToZero(
  pct: number,
  decayPerSecondBase: number,
  state: AppState,
  atMs: number
): number | null {
  if (pct <= 0 || state.condition === 'dead') return null;
  const bgm = backgroundGaugeDecayMultiplier(state, atMs);
  // ゲージが0%になる到達時刻に通知する。少し前倒しにはしない。
  const rate = decayPerSecondBase * bgm;
  if (rate <= 0) return null;
  const sec = Math.ceil(pct / rate);
  if (sec < 5) return 5;
  if (sec > 3600 * 24 * 14) return null;
  return sec;
}

function careAlertCopy(fullnessEmpty: boolean, viscosityEmpty: boolean): { title: string; body: string; type: string } {
  if (fullnessEmpty && viscosityEmpty) {
    return {
      title: 'おなかとぬめりが0%になりました',
      body: 'オオサンショウウオにごはんとおみずをあげましょう。',
      type: 'care_empty_both',
    };
  }
  if (fullnessEmpty) {
    return {
      title: 'おなかがすきました',
      body: 'オオサンショウウオにごはんをあげましょう。',
      type: 'care_empty_feed',
    };
  }
  return {
    title: 'ヌメリがかわきました',
    body: 'オオサンショウウオにおみずをあげましょう。',
    type: 'care_empty_water',
  };
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
 * おなか・ヌメリが両方0%になった時に1件だけ送り、放置中は3日後・7日後にだけ再通知する。
 * 以後は既存の14日後・30日後の再訪通知へ引き継ぐ。
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
  if (state.condition === 'dead') return;

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

  const bothAlreadyEmpty = state.fullness <= 0 && state.viscosity <= 0;
  const secondsUntilBothEmpty = Math.max(fSec ?? 0, vSec ?? 0);
  if (!bothAlreadyEmpty && !Number.isFinite(secondsUntilBothEmpty)) return;

  const firstAlert = careAlertCopy(true, true);
  const reminderAlert = careAlertCopy(true, true);
  const followUpAlert = careAlertCopy(true, true);
  const threeDaysSeconds = 3 * 24 * 60 * 60;
  const sevenDaysSeconds = 7 * 24 * 60 * 60;
  const initialDelaySeconds = bothAlreadyEmpty ? 0 : Math.max(60, secondsUntilBothEmpty);

  try {
    if (!bothAlreadyEmpty) {
      const initialTrigger = {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: initialDelaySeconds,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
      } as const;
      scheduledCareInitialAlertId = await Notifications.scheduleNotificationAsync({
        content: { title: firstAlert.title, body: firstAlert.body, data: { type: firstAlert.type }, sound: true },
        trigger: initialTrigger,
      });
      await AsyncStorage.setItem(CARE_NOTIFICATION_ID_KEY, scheduledCareInitialAlertId);
    }

    const reminderTrigger = {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: initialDelaySeconds + threeDaysSeconds,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
    } as const;
    scheduledCareReminderAlertId = await Notifications.scheduleNotificationAsync({
      content: { title: reminderAlert.title, body: reminderAlert.body, data: { type: reminderAlert.type }, sound: true },
      trigger: reminderTrigger,
    });
    await AsyncStorage.setItem(CARE_REMINDER_NOTIFICATION_ID_KEY, scheduledCareReminderAlertId);

    const followUpTrigger = {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: initialDelaySeconds + sevenDaysSeconds,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_CARE } : {}),
    } as const;
    scheduledCareFollowUpAlertId = await Notifications.scheduleNotificationAsync({
      content: { title: followUpAlert.title, body: followUpAlert.body, data: { type: followUpAlert.type }, sound: true },
      trigger: followUpTrigger,
    });
    await AsyncStorage.setItem(CARE_FOLLOW_UP_NOTIFICATION_ID_KEY, scheduledCareFollowUpAlertId);
    await scheduleInactivityReminder();
    await scheduleThirtyDayReminder();
  } catch (e) {
    console.warn('schedulePredictiveGaugeAlerts:', e);
  }
}

/** フォアグラウンド復帰時: 古い予約を消す（既に回復していても鳴らないように） */
export async function clearPredictiveGaugeAlerts(): Promise<void> {
  await cancelPredictiveSchedules();
}

/** 開発用: おなか・ヌメリが両方空いた通知をすぐ確認する。 */
export async function notifyCareEmptyNow(): Promise<void> {
  await sendImmediateNotification(
    'おなかとぬめりが0%になりました',
    'オオサンショウウオにごはんとおみずをあげましょう。',
    'care_empty_test'
  );
}

/** 開発時の通知表示確認用。14日ぶりの再訪メッセージを即時送信する。 */
export async function notifyInactivityReminderNow(): Promise<void> {
  await sendImmediateNotification(
    'しばらく会えていません',
    'オオサンショウウオが弱っています。会いにいきましょう。',
    'inactivity_reminder_test'
  );
}

/** 開発時の通知表示確認用。30日ぶりの再訪メッセージを即時送信する。 */
export async function notifyThirtyDayReminderNow(): Promise<void> {
  await sendImmediateNotification(
    '30日間会えていません',
    'オオサンショウウオが、静かに旅立とうとしています。会いにいきましょう。',
    'thirty_day_reminder_test'
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
