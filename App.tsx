import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Image,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  Easing,
  AppState as RNAppState,
  Modal,
  KeyboardAvoidingView,
  Pressable,
  type GestureResponderEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  AppState,
  createInitialState,
  getDaysDiff,
  processGrowth,
  processCondition,
  generateDailyLog,
  formatOosanLengthCm,
  GROWTH_TARGET_CM,
  DISPLAY_LENGTH_CAP_CM,
  ADULT_OOSAN_MIN_LENGTH_CM,
  GROWTH_CM_PER_SECOND,
  MS_TO_REACH_TARGET_LENGTH,
  migrateAppState,
  patchStateForDebugBodyLengthCm,
  computeIsNight,
  computeIsMorning,
  computeIsDaytime,
  computeGrowthMultiplier,
  formatGrowthMultiplier,
  getGrowthPhaseLabel,
  fullnessBarColor,
  viscosityBarColor,
  backgroundGaugeDecayMultiplier,
  DEFAULT_NIGHT_CARE_MULTIPLIER,
  DAYS_UNTIL_INACTIVITY_REMINDER,
  applyCareAction,
  claimDailyCareMissionReward,
  claimDailyPetMissionReward,
  resetDailyMissionsForDebug,
  careGrowthPointsForGauge,
  dailyCareGrowthPointCapForLevel,
  affectionLevelForValue,
  affectionHeartColorForLevel,
  affectionEffectHeartCountForLevel,
  affectionHeartCountForLevel,
  affectionStageForLevel,
  affectionProgressForValue,
  AFFECTION_MODEL_VERSION,
  DAILY_PET_BONUS_USES,
  dailyPetNormalLimitForAffectionValue,
  growthPointsRequiredForLevel,
  GROWTH_STAGES,
  claimGrowthMissionReward,
  applyGrowthMissionBonusCare,
  growthMissionIdForCm,
  growthMissionRewardKindForCm,
  growthMissionRewardForCm,
  growthMissionDirectPointsForCm,
  GrowthMissionRewardKind,
  DEFAULT_OOSAN_NAME,
  normalizeOosanName,
} from './src/logic';
import { DebugTimeProvider, useDebugTime } from './src/DebugTimeContext';
import { DebugOverlay } from './src/DebugOverlay';
import { LegalInfoModal } from './src/LegalInfoModal';
import { GrowthGuideModal } from './src/GrowthGuideModal';
import { pickTapMessage, pickOosanMessage, oosanMessageUsesName } from './src/tapMessages';
import { ADULT_WALK_FRAMES } from './src/adultWalkFrames';
import {
  applyOfflineCatchUp,
  findBackloggedMilestones,
  findNewlyCompletedMilestones,
  getNextMilestoneLine,
  hourlyGoalLabel,
  milestoneQualifies,
  paginateOfflineBacklog,
  type MilestoneDef,
} from './src/milestones';
import {
  prepareCareGaugeNotifications,
  schedulePredictiveGaugeAlerts,
  clearPredictiveGaugeAlerts,
  notifyCareEmptyNow,
  notifyInactivityReminderNow,
  notifyThirtyDayReminderNow,
} from './src/careGaugeNotifications';

/**
 * 開発用・体長 100cm 固定（画面上は最大スケールのまま）
 * ─ App.tsx この定数だけ。false で無効（通常プレイ）。
 * true にしたあと一度でも保存されると、AsyncStorage に 100cm が残る。フラグを false にしてもデータは戻らない。
 */
const DEBUG_FORCE_MAX_OOSAN_LENGTH = false;

/**
 * 緊急リセット: true にしてアプリを1回起動すると、体長・成長アンカー・マイルストーン達成記録を初期化して保存する。
 * 直したら必ず false に戻すこと。（100cm デバッグの残りデータを捨てたいとき用。他の日付ログ等はそのまま）
 */
const DEBUG_RESET_GROWTH_PROGRESS_ONCE = false;

const growthRewardLabel = (reward: GrowthMissionRewardKind, uses: number = 3): string => {
  // 通常のお世話と区別できるよう、「ごほうび」は必ず残す。
  if (reward === 'feed') return `ごほうびごはん×${uses}`;
  if (reward === 'water') return `ごほうびおみず×${uses}`;
  if (reward === 'both') return `ごほうびごはん・おみず 各${uses}回`;
  return '報酬なし';
};

const growthRewardIcon = (reward: GrowthMissionRewardKind): keyof typeof Ionicons.glyphMap =>
  reward === 'feed' ? 'restaurant' : reward === 'water' ? 'water' : reward === 'both' ? 'gift' : 'sparkles';


type MissionRewardPopup = {
  kind: 'care' | 'pet' | 'growth';
  amount?: number;
  directPoints?: number;
  reward?: GrowthMissionRewardKind;
};

type QueuedCelebrationPopup =
  | { kind: 'adult' }
  | { kind: 'stage'; stage: { cm: number; name: string } }
  | { kind: 'length'; data: { cm: number; bodyLengthCm: number } }
  | { kind: 'affection'; data: { level: number; name: string } };
/** セーブする元文言を壊さず、日々のひとことだけを名前入りで表示する。 */
const namedOosanNarration = (name: string, text: string): string => `${name}は${text}`;

/**
 * 開発用: true なら時刻に関係なく朝 UI（太陽・「朝」）を表示し、夜のベール・三日月は出さない。
 * 成長倍率は実時刻のまま。検証後は false に戻す。
 */
const DEBUG_FORCE_MORNING_UI = __DEV__ && false;

/**
 * 開発用: true なら時刻に関係なく昼 UI（晴れ間アイコン・「昼」）を表示し、夜のベール・三日月は出さない。
 * DEBUG_FORCE_MORNING_UI と同時に true にしないこと。検証後は false に戻す。
 */
const DEBUG_FORCE_DAY_UI = __DEV__ && false;

// AsyncStorage のキー
const STORAGE_KEY = 'oosanRiverState';

/**
 * 満腹（おなか）が平均して 1% 減るまでの目安秒数（毎秒の減りにジッターを掛ける）
 */
const FULLNESS_SECONDS_PER_ONE_PERCENT = 432;

/** ヌメリもおなかと同じく、100%→0% を平均12時間にそろえる。 */
const VISCOSITY_SECONDS_PER_ONE_PERCENT = 432;

const FULLNESS_DECAY_PER_SECOND = 1 / FULLNESS_SECONDS_PER_ONE_PERCENT;
const VISCOSITY_DECAY_PER_SECOND = 1 / VISCOSITY_SECONDS_PER_ONE_PERCENT;
/**
 * 満タン直後の連打だけを防ぐための、ごく短い待機ライン。
 * 99%ならすでに+1ptを得られる仕様なので、以前の「約4時間」基準は使わない。
 */
const CARE_POINT_UNLOCK_PERCENT = 99.5;

const growthPointWaitLabel = (gaugePercent: number, secondsPerOnePercent: number): string => {
  // ゲージの表示値と「受取OK」判定が食い違わないよう、区切りも表示と同じ整数にそろえる。
  const displayedGauge = Math.round(gaugePercent);
  const seconds = Math.max(0, displayedGauge - CARE_POINT_UNLOCK_PERCENT) * secondsPerOnePercent;
  if (seconds <= 1) return '+1pt！';
  const totalMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // 操作ボタン下の小さな枠でも、末尾の「+1pt」まで必ず読める長さにする。
  return hours > 0 ? `あと${hours}時間で+1pt` : `あと${minutes}分で+1pt`;
};

/**
 * フォアグラウンド中のおなか・ヌメリ減少に掛ける倍率（基準は各 SECONDS_PER_ONE_PERCENT）。
 * 開いているときも閉じているときも、100→0 は平均約12時間。
 * 連打で100%からわずかに減ることを防ぎ、ゆっくり育てられる速度にする。
 */
const GAUGE_DECAY_MULT_FOREGROUND = 1;

/** 毎秒の減少量に掛ける乱数（平均 1.0、やや狭い幅） */
const DECAY_JITTER_MIN = 0.9;
const DECAY_JITTER_MAX = 1.1;

function sampleDecayJitter(): number {
  return DECAY_JITTER_MIN + Math.random() * (DECAY_JITTER_MAX - DECAY_JITTER_MIN);
}

// AsyncStorage から状態を読み込む
export const loadState = async (): Promise<AppState> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (typeof parsed.growthAnchorMs !== 'number' || !Number.isFinite(parsed.growthAnchorMs as number)) {
        parsed.growthAnchorMs = Date.now();
      }
      return migrateAppState(parsed);
    }
  } catch (error) {
    console.error('Failed to load state:', error);
  }
  return createInitialState();
};

// AsyncStorage に状態を保存
export const saveState = async (state: AppState): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save state:', error);
  }
};

type PfxKind = 'feed' | 'water' | 'bonusFeed' | 'bonusWater' | 'bonusPet';

const ESA_FALL_IMG = require('./assets/images/esa.png');
const MIZU_FALL_IMG = require('./assets/images/mizu.png');

type FallingPfx = {
  id: number;
  kind: PfxKind;
  /** 画面幅に対する出現位置 0〜100（%） */
  leftPct: number;
  size: number;
  /** 落下終了までの横漂い（px） */
  drift: number;
  delayMs: number;
  durationMs: number;
  spinFromDeg: number;
  spinToDeg: number;
};

const MainLengthCounter: React.FC<{ cmText: string; phase: string }> = ({ cmText, phase }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  const fracGlow = useRef(new Animated.Value(1)).current;
  const prev = useRef(cmText);
  useEffect(() => {
    if (prev.current !== cmText) {
      prev.current = cmText;
      pulse.setValue(0.96);
      fracGlow.setValue(0.62);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.03,
            duration: 100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.spring(pulse, { toValue: 1, friction: 7, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(fracGlow, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }
  }, [cmText, pulse, fracGlow]);
  const [head, tail] = cmText.includes('.') ? cmText.split('.') : [cmText, ''];
  return (
    <View style={styles.mainCounterValueCol}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Text style={styles.mainCounterLine}>
          <Text style={styles.mainCounterInt}>{head}</Text>
          <Text style={styles.mainCounterDot}>.</Text>
          <Animated.Text style={[styles.mainCounterFrac, { opacity: fracGlow }]}>{tail}</Animated.Text>
          <Text style={styles.mainCounterUnit}> cm</Text>
        </Text>
      </Animated.View>
      <Text style={styles.phaseLabel}>{phase}</Text>
    </View>
  );
};

/** 上部の丸いレベルゲージ。細かなセグメントで水色のチャージリングを表す。 */
const LevelProgressOrb: React.FC<{
  cmText: string;
  bodyLengthCm: number;
  points: number;
  pointsNeeded: number;
  onPress: () => void;
  pointGain: { id: number; amount: number; source: 'feed' | 'water' | 'mission' } | null;
}> = ({ cmText, bodyLengthCm, points, pointsNeeded, onPress, pointGain }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  const gainProgress = useRef(new Animated.Value(0)).current;
  const segmentCount = 40;
  // 1cm以降は「整数cmから次の1cmまで」を1周として見せる。
  const rangeStart = bodyLengthCm < 0.5 ? 0 : bodyLengthCm < 1 ? 0.5 : Math.floor(bodyLengthCm);
  const rangeEnd = bodyLengthCm < 0.5
      ? 0.5
      : bodyLengthCm < 1
        ? 1
        : Math.floor(bodyLengthCm) + 1;
  const rangeProgress = rangeEnd <= rangeStart
    ? 1
    : Math.max(0, Math.min(1, (bodyLengthCm - rangeStart) / (rangeEnd - rangeStart)));
  const filledSegments = Math.min(segmentCount, Math.ceil(rangeProgress * segmentCount));

  useEffect(() => {
    if (!pointGain) return;
    pulse.setValue(1);
    gainProgress.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.delay(580),
        Animated.spring(pulse, { toValue: 1.13, friction: 5, useNativeDriver: true }),
        Animated.spring(pulse, { toValue: 1, friction: 6, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(540),
        Animated.timing(gainProgress, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [pointGain, pulse, gainProgress]);

  return (
    <Pressable
      style={styles.levelOrbHitArea}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel="体長と次の1cmまでの進み具合を開く"
    >
      <Animated.View style={[styles.levelOrb, { transform: [{ scale: pulse }] }]}>
        {pointGain && (
          <Animated.View
            key={pointGain.id}
            pointerEvents="none"
            style={[
              styles.levelOrbChargeFlash,
              {
                opacity: gainProgress.interpolate({ inputRange: [0, 0.15, 0.65, 1], outputRange: [0, 0.9, 0.38, 0] }),
                transform: [{ scale: gainProgress.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1.28] }) }],
              },
            ]}
          />
        )}
        {Array.from({ length: segmentCount }, (_, index) => {
          const angle = (Math.PI * 2 * index) / segmentCount - Math.PI / 2;
          const radius = 37;
          return (
            <View
              key={index}
              style={[
                styles.levelOrbSegment,
                {
                  left: 41 + Math.cos(angle) * radius - 1.5,
                  top: 41 + Math.sin(angle) * radius - 3.5,
                  transform: [{ rotate: `${(index * 360) / segmentCount}deg` }],
                  backgroundColor: index < filledSegments ? '#42b7e9' : 'rgba(35, 139, 189, 0.18)',
                },
              ]}
            />
          );
        })}
        <Text style={styles.levelOrbLabel}>体長</Text>
        <Text style={styles.levelOrbValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68}>
          {cmText}
        </Text>
        <Text style={styles.levelOrbUnit}>cm</Text>
        <Text style={styles.levelOrbPoints}>{pointsNeeded > 0 ? `${Number.isInteger(points) ? points : points.toFixed(1)} / ${pointsNeeded} pt` : 'MAX'}</Text>
      </Animated.View>
    </Pressable>
  );
};

/** ごはん・おみずで得た成長ポイントが、体長リングへ吸い込まれる演出。 */
const GrowthPointFlight: React.FC<{
  gain: { id: number; amount: number; source: 'feed' | 'water' | 'mission' };
  screenWidth: number;
  screenHeight: number;
}> = ({ gain, screenWidth, screenHeight }) => {
  const progress = useRef(new Animated.Value(0)).current;
  const startX = gain.source === 'feed' ? screenWidth * 0.19 : screenWidth * 0.5;
  const startY = gain.source === 'mission' ? screenHeight * 0.3 : screenHeight - (Platform.OS === 'ios' ? 98 : 74);
  const targetX = screenWidth * 0.5;
  const targetY = Platform.OS === 'ios' ? 96 : 84;

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 1600,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [gain.id, progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.growthPointFlight,
        {
          left: startX - 43,
          top: startY,
          opacity: progress.interpolate({ inputRange: [0, 0.06, 0.82, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, targetX - startX] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, targetY - startY] }) },
            { scale: progress.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0.75, 1.08, 0.8, 0.45] }) },
          ],
        },
      ]}
    >
      <Text style={styles.growthPointFlightText}>体長 +{gain.amount}pt</Text>
    </Animated.View>
  );
};

const FallingImageParticle: React.FC<{ p: FallingPfx; fallDistance: number }> = ({
  p,
  fallDistance,
}) => {
  const t = useRef(new Animated.Value(0)).current;
  const isBonusFeed = p.kind === 'bonusFeed';
  const isBonusWater = p.kind === 'bonusWater';
  const isBonusPet = p.kind === 'bonusPet';
  const src = p.kind === 'feed' ? ESA_FALL_IMG : MIZU_FALL_IMG;
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: p.durationMs,
      delay: p.delayMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [t, p.delayMs, p.durationMs]);
  const translateY = t.interpolate({
    inputRange: [0, 1],
    outputRange: [-Math.max(48, p.size * 0.6), fallDistance],
  });
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
  const rotate = t.interpolate({
    inputRange: [0, 1],
    outputRange: [`${p.spinFromDeg}deg`, `${p.spinToDeg}deg`],
  });
  /** 落下距離の約半分（t≈0.4〜0.55）でフェードアウト */
  const opacity = t.interpolate({
    inputRange: [0, 0.38, 0.52, 1],
    outputRange: [1, 1, 0, 0],
    extrapolate: 'clamp',
  });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        left: `${p.leftPct}%`,
        marginLeft: -p.size / 2,
        opacity,
        transform: [{ translateX }, { translateY }, { rotate }],
      }}
    >
      {isBonusFeed ? (
        <Text style={{ fontSize: p.size * 0.7 }}>{['🦀', '🦐', '🐟'][p.id % 3]}</Text>
      ) : isBonusWater ? (
        <View style={styles.bonusWaterParticle}>
          <Ionicons name="water" size={p.size * 0.7} color="#55c9f1" />
          <Text style={styles.bonusWaterSparkle}>✦</Text>
        </View>
      ) : isBonusPet ? (
        <View style={styles.bonusPetParticle}>
          <Text style={[styles.bonusPetFallingHeart, { fontSize: p.size * 0.8 }]}>♥</Text>
          <Text style={styles.bonusPetFallingSparkle}>✦</Text>
        </View>
      ) : (
        <Image source={src} style={{ width: p.size, height: p.size }} resizeMode="contain" />
      )}
    </Animated.View>
  );
};

/** なでられた喜びを表す、短いハートの浮遊演出。 */
const FloatingPetHeart: React.FC<{
  delay: number;
  horizontalOffset: number;
  size: number;
  durationMs: number;
  color: string;
  symbol?: string;
  slowGrow?: boolean;
  peakScale?: number;
}> = ({ delay, horizontalOffset, size, durationMs, color, symbol = '♥', slowGrow = false, peakScale = 1.1 }) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        toValue: 1,
        duration: durationMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, durationMs, progress]);

  const travel = Math.max(42, size * 0.32);
  const heartScale = slowGrow
    ? progress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [0.42, peakScale, peakScale * 1.08] })
    : progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.55, 1.1, 0.9] });
  return (
    <Animated.Text
      style={[
        styles.petHeart,
        { color },
        {
          left: size * 0.5 + horizontalOffset,
          opacity: progress.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -travel] }) },
            { scale: heartScale },
          ],
        },
      ]}
    >
      {symbol}
    </Animated.Text>
  );
};

const PetHeartBurst: React.FC<{
  size: number;
  heartCount: number;
  color: string;
  startDelay?: number;
  symbol?: string;
  durationMsOverride?: number;
  slowGrow?: boolean;
  peakScale?: number;
}> = ({
  size,
  heartCount,
  color,
  startDelay = 0,
  symbol = '♥',
  durationMsOverride,
  slowGrow = false,
  peakScale,
}) => {
  const count = Math.max(1, Math.min(10, heartCount));
  const durationMs = durationMsOverride ?? (count === 1 ? 1400 : count <= 3 ? 1050 : 720);
  return (
    <View pointerEvents="none" style={[styles.petHeartLayer, { width: size, height: size * 0.8, marginLeft: -size / 2 }]}>
      {Array.from({ length: count }, (_, index) => {
        const progress = count === 1 ? 0.5 : index / (count - 1);
        return (
          <FloatingPetHeart
            key={index}
            delay={startDelay + index * 75}
            horizontalOffset={(progress - 0.5) * size * 0.7}
            size={size}
            durationMs={durationMs}
            color={color}
            symbol={symbol}
            slowGrow={slowGrow}
            peakScale={peakScale}
          />
        );
      })}
    </View>
  );
};

/** 1の位はハート数、10の位は色と「+20」表記で表す。 */
const AffectionLevelHearts: React.FC<{ level: number }> = ({ level }) => {
  const safeLevel = Math.max(1, Math.min(100, Math.floor(level)));
  const heartCount = affectionHeartCountForLevel(safeLevel);
  const completedTens = Math.floor(safeLevel / 10) * 10;
  const color = affectionHeartColorForLevel(safeLevel);
  return (
    <View style={styles.affectionHeartsRow} accessibilityLabel={`なつきLv.${safeLevel} / 100`}>
      {completedTens > 0 && (
        <View style={styles.affectionHeartCarry}>
          <Text style={[styles.affectionHeartCarryText, { color }]}>+{completedTens}</Text>
        </View>
      )}
      <Text style={[styles.affectionHeartSet, { color }]}>{'♥'.repeat(heartCount)}{'♡'.repeat(10 - heartCount)}</Text>
    </View>
  );
};

/** なつきゲージが満タンになった瞬間だけ、満ちる動きを強調する。 */
const AffectionGaugeFullEffect: React.FC<{ color: string }> = ({ color }) => {
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(fill, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [fill]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.affectionGaugeFullEffect,
        { backgroundColor: color, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
      ]}
    />
  );
};

async function runConfettiBurst(): Promise<void> {
  if (Platform.OS !== 'web') return;
  try {
    const g = globalThis as unknown as { window?: Window };
    if (!g.window) return;
    const confetti = (await import('canvas-confetti')).default;
    confetti({ particleCount: 160, spread: 80, origin: { y: 0.5 }, zIndex: 9999 });
  } catch {
    /* noop */
  }
}

/** タップした川面に波紋（オオサンが向かう「合図」が視覚的に分かる） */
const TapWaterRipple: React.FC<{
  x: number;
  y: number;
  rippleId: number;
  onRemove: (id: number) => void;
}> = ({ x, y, rippleId, onRemove }) => {
  const scale1 = useRef(new Animated.Value(0.22)).current;
  const opacity1 = useRef(new Animated.Value(0.62)).current;
  const scale2 = useRef(new Animated.Value(0.16)).current;
  const opacity2 = useRef(new Animated.Value(0.42)).current;
  useEffect(() => {
    const native = Platform.OS !== 'web';
    const outC = Easing.out(Easing.cubic);
    const outQ = Easing.out(Easing.quad);
    const anim = Animated.parallel([
      Animated.parallel([
        Animated.timing(scale1, {
          toValue: 2.4,
          duration: 800,
          easing: outC,
          useNativeDriver: native,
        }),
        Animated.timing(opacity1, {
          toValue: 0,
          duration: 740,
          easing: outQ,
          useNativeDriver: native,
        }),
      ]),
      Animated.sequence([
        Animated.delay(120),
        Animated.parallel([
          Animated.timing(scale2, {
            toValue: 2.95,
      duration: 1400,
            easing: outC,
            useNativeDriver: native,
          }),
          Animated.timing(opacity2, {
            toValue: 0,
            duration: 840,
            easing: outQ,
            useNativeDriver: native,
          }),
        ]),
      ]),
    ]);
    anim.start(({ finished }) => {
      if (finished) onRemove(rippleId);
    });
    return () => anim.stop();
  }, [rippleId, onRemove, scale1, opacity1, scale2, opacity2]);
  const base = 54;
  const r = base / 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: base,
        height: base,
        marginLeft: -r,
        marginTop: -r,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: base,
          height: base,
          borderRadius: r,
          borderWidth: 2,
          borderColor: 'rgba(188, 244, 226, 0.92)',
          backgroundColor: 'rgba(95, 205, 178, 0.12)',
          transform: [{ scale: scale1 }],
          opacity: opacity1,
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          width: base * 0.7,
          height: base * 0.7,
          borderRadius: (base * 0.7) / 2,
          borderWidth: 1.5,
          borderColor: 'rgba(232, 255, 248, 0.5)',
          transform: [{ scale: scale2 }],
          opacity: opacity2,
        }}
      />
    </View>
  );
};

const SparkleOverlay: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(op, { toValue: 0, duration: 2200, useNativeDriver: true }).start(() => onDone());
  }, [op, onDone]);
  const glyphs = ['✨', '✦', '✧', '·˖', '✨', '✦'];
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.sparkleLayer, { opacity: op, zIndex: 200 }]}
    >
      {glyphs.map((c, i) => (
        <Text
          key={i}
          style={[
            styles.sparkleGlyph,
            { left: `${8 + (i * 14) % 78}%`, top: `${12 + ((i * 7) % 40)}%` },
          ]}
        >
          {c}
        </Text>
      ))}
    </Animated.View>
  );
};

// メインコンポーネント（DebugTimeProvider 内でマウント）
const AppMain: React.FC = () => {
  const { getNow, timeOffsetMs, debugNightCareMultiplier } = useDebugTime();
  const timeOffsetRef = useRef(0);
  const nightCareRef = useRef<number | null>(null);
  timeOffsetRef.current = timeOffsetMs;
  nightCareRef.current = debugNightCareMultiplier;

  const [state, setState] = useState<AppState | null>(null);
  const [isPetting, setIsPetting] = useState(false);
  const [isBonusPetting, setIsBonusPetting] = useState(false);
  const [isOosanDragging, setIsOosanDragging] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(Platform.OS === 'web');
  const [isMovingRight, setIsMovingRight] = useState(false); // オオサンショウウオが右に動いているかどうか
  const [isOosanWalking, setIsOosanWalking] = useState(false);
  const [adultWalkFrameIndex, setAdultWalkFrameIndex] = useState(0);
  const isAdultForAnimation =
    state?.condition !== 'dead' && (state?.bodyLengthCm ?? 0) >= ADULT_OOSAN_MIN_LENGTH_CM;
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  // オオサンショウウオの位置アニメーション（X座標とY座標）
  const oosanXAnim = React.useRef(new Animated.Value(0)).current;
  const oosanYAnim = React.useRef(new Animated.Value(0)).current;
  const oosanLayoutSizeRef = useRef(48);
  const oosanLengthCmRef = useRef(0);
  const [particles, setParticles] = useState<FallingPfx[]>([]);
  const particleSerial = useRef(0);
  const nightDim = useRef(new Animated.Value(computeIsNight() ? 1 : 0)).current;
  const nightRef = useRef(computeIsNight());
  const dailyLogOpacity = useRef(new Animated.Value(0)).current;
  const [offlineBacklogPageQueue, setOfflineBacklogPageQueue] = useState<MilestoneDef[][]>([]);
  const offlineBacklogModalMetaRef = useRef<{ total: number; pageCount: number } | null>(null);
  const [celebrationItem, setCelebrationItem] = useState<MilestoneDef | null>(null);
  const [celebrationQueue, setCelebrationQueue] = useState<MilestoneDef[]>([]);
  const [sparkleActive, setSparkleActive] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const prevFullStateRef = useRef<AppState | null>(null);
  const skipNextMilestoneDiffRef = useRef(false);
  const stateRef = useRef<AppState | null>(null);
  const appStateSubRef = useRef(RNAppState.currentState);
  /** タップ移動と自動うろうろの競合を避ける（値が変わったら進行中の遅延チェーンは捨てる） */
  const wanderGenRef = useRef(0);
  const moveOosanRef = useRef<(() => void) | null>(null);
  const [tapRipples, setTapRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const tapRippleSerial = useRef(0);
  /** タップ座標を子 View の location ではなく Pressable 全体に対して取る */
  const mainPressableRef = useRef<View | null>(null);
  /** オオサンショウウオを指で動かしている間の開始位置。 */
  const oosanDragRef = useRef<{ pageX: number; pageY: number; x: number; y: number; moved: boolean; generation: number } | null>(null);
  const consumeOosanTouchRef = useRef(false);
  const [legalInfoOpen, setLegalInfoOpen] = useState(false);
  const [careWarningOpen, setCareWarningOpen] = useState<{ kind: 'feed' | 'water'; isEmpty: boolean } | null>(null);
  const [careTimingInfoOpen, setCareTimingInfoOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [newOosanGuideOpen, setNewOosanGuideOpen] = useState(false);
  // 初回の名前決定後だけ、ごはん・おみずの場所を金色のごほうび風に案内する。
  const [initialCareGuide, setInitialCareGuide] = useState({ feed: false, water: false });
  const [nameEditorOpen, setNameEditorOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(DEFAULT_OOSAN_NAME);
  const [missionOpen, setMissionOpen] = useState(false);
  const [dailyMissionRewardPopup, setDailyMissionRewardPopup] = useState<MissionRewardPopup | null>(null);
  /** ミッション一覧がフェードアウトしてから報酬を出すための待機状態。 */
  const [pendingMissionRewardPopup, setPendingMissionRewardPopup] = useState<MissionRewardPopup | null>(null);
  const [queuedCelebrationPopups, setQueuedCelebrationPopups] = useState<QueuedCelebrationPopup[]>([]);
  const [growthGuideOpen, setGrowthGuideOpen] = useState(false);
  const [adultEvolutionOpen, setAdultEvolutionOpen] = useState(false);
  const [growthLengthUp, setGrowthLengthUp] = useState<{ cm: number; bodyLengthCm: number } | null>(null);
  const [affectionLevelUp, setAffectionLevelUp] = useState<{ level: number; name: string } | null>(null);
  const [affectionGaugeCelebration, setAffectionGaugeCelebration] = useState<{ level: number; name: string } | null>(null);
  const [growthStageNotice, setGrowthStageNotice] = useState<{ cm: number; name: string } | null>(null);
  const [growthPointGain, setGrowthPointGain] = useState<{ id: number; amount: number; source: 'feed' | 'water' | 'mission' } | null>(null);
  const growthPointGainSerial = useRef(0);
  const pendingGrowthPointGainRef = useRef<{ amount: number; source: 'feed' | 'water' | 'mission' } | null>(null);
  const previousBodyLengthRef = useRef<number | null>(null);
  const previousAffectionLevelRef = useRef<number | null>(null);
  const affectionGaugeCelebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [careSpeech, setCareSpeech] = useState<string | null>(null);
  const careSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTapRipple = useCallback((id: number) => {
    setTapRipples((list) => list.filter((t) => t.id !== id));
  }, []);

  const showCareSpeech = useCallback((message: string) => {
    if (careSpeechTimerRef.current) clearTimeout(careSpeechTimerRef.current);
    setCareSpeech(message);
    careSpeechTimerRef.current = setTimeout(() => {
      setCareSpeech(null);
      careSpeechTimerRef.current = null;
    }, 2600);
  }, []);

  const showCareGaugeWarning = useCallback((kind: 'feed' | 'water', isEmpty: boolean) => {
    setCareWarningOpen({ kind, isEmpty });
  }, []);

  const hasActiveCelebrationPopup =
    adultEvolutionOpen || growthStageNotice != null || growthLengthUp != null || affectionLevelUp != null;

  const showCelebrationPopup = useCallback((popup: QueuedCelebrationPopup) => {
    if (popup.kind === 'adult') setAdultEvolutionOpen(true);
    if (popup.kind === 'stage') setGrowthStageNotice(popup.stage);
    if (popup.kind === 'length') setGrowthLengthUp(popup.data);
    if (popup.kind === 'affection') setAffectionLevelUp(popup.data);
  }, []);

  /** 報酬・成長演出の全画面モーダルを決して重ねない。 */
  const queueCelebrationPopup = useCallback((popup: QueuedCelebrationPopup) => {
    if (missionOpen || dailyMissionRewardPopup != null || pendingMissionRewardPopup != null || hasActiveCelebrationPopup) {
      setQueuedCelebrationPopups((queue) => [...queue, popup]);
      return;
    }
    showCelebrationPopup(popup);
  }, [dailyMissionRewardPopup, hasActiveCelebrationPopup, missionOpen, pendingMissionRewardPopup, showCelebrationPopup]);

  const showGrowthStageNotice = useCallback((stage: { cm: number; name: string }) => {
    queueCelebrationPopup({ kind: 'stage', stage });
  }, [queueCelebrationPopup]);

  const openNameEditor = useCallback(() => {
    setNameDraft(state?.oosanName ?? DEFAULT_OOSAN_NAME);
    setNameEditorOpen(true);
  }, [state?.oosanName]);

  const closeNewOosanGuide = useCallback(() => {
    setNewOosanGuideOpen(false);
  }, []);

  const saveOosanName = useCallback(() => {
    const oosanName = normalizeOosanName(nameDraft);
    setState((s) => {
      if (!s) return s;
      const next = { ...s, oosanName };
      void saveState(next);
      return next;
    });
    setNameDraft(oosanName);
    setNameEditorOpen(false);
  }, [nameDraft]);

  /** 初回案内では、名前と「お世話を始める」を一度の決定で完了させる。 */
  const beginLifeWithOosan = useCallback(() => {
    const oosanName = normalizeOosanName(nameDraft);
    setState((s) => {
      if (!s) return s;
      const next = { ...s, oosanName };
      void saveState(next);
      return next;
    });
    setNameDraft(oosanName);
    setNewOosanGuideOpen(false);
    setInitialCareGuide({ feed: true, water: true });
  }, [nameDraft]);

  useEffect(() => () => {
    if (careSpeechTimerRef.current) clearTimeout(careSpeechTimerRef.current);
    if (affectionGaugeCelebrationTimerRef.current) clearTimeout(affectionGaugeCelebrationTimerRef.current);
  }, []);

  /** 死亡状態から、保存済みの育成データを初期状態へ戻して再開する。 */
  const restartWithNewOosan = useCallback(() => {
    setRestartConfirmOpen(true);
  }, []);

  const confirmRestartWithNewOosan = useCallback(() => {
    const initialState = createInitialState();
    setParticles([]);
    setTapRipples([]);
    setCelebrationQueue([]);
    setCelebrationItem(null);
    setOfflineBacklogPageQueue([]);
    offlineBacklogModalMetaRef.current = null;
    void clearPredictiveGaugeAlerts();
    setRestartConfirmOpen(false);
    setState(initialState);
    void saveState(initialState);
    setNewOosanGuideOpen(true);
  }, []);

  const commitClaimMilestone = useCallback(
    (m: MilestoneDef) => {
      const nowMs = getNow().getTime();
      setState((s) => {
        if (!s || s.claimedMilestoneIds.includes(m.id)) return s;
        if (!milestoneQualifies(m, s, nowMs)) return s;
        const n = { ...s, claimedMilestoneIds: [...s.claimedMilestoneIds, m.id] };
        void saveState(n);
        return n;
      });
    },
    [getNow]
  );

  const commitClaimMany = useCallback((list: MilestoneDef[]) => {
    if (list.length === 0) return;
    setState((s) => {
      if (!s) return s;
      const set = new Set(s.claimedMilestoneIds);
      for (const m of list) set.add(m.id);
      const n = { ...s, claimedMilestoneIds: Array.from(set) };
      void saveState(n);
      return n;
    });
  }, []);

  const applyDebugBodyLengthCm = useCallback((cm: number) => {
    setCelebrationQueue([]);
    setCelebrationItem(null);
    setSparkleActive(false);
    setBannerMsg(null);
    bannerAnim.stopAnimation();
    bannerAnim.setValue(0);
    setOfflineBacklogPageQueue([]);
    offlineBacklogModalMetaRef.current = null;
    skipNextMilestoneDiffRef.current = true;
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = patchStateForDebugBodyLengthCm(s, cm);
      void saveState(n);
      return n;
    });
    setNewOosanGuideOpen(true);
  }, [bannerAnim]);

  const applyDebugGauges = useCallback(
    (patch: { fullness?: number; viscosity?: number }) => {
      setState((s) => {
        if (!s || s.condition === 'dead') return s;
        const n = {
          ...s,
          ...(patch.fullness !== undefined
            ? {
                fullness: Math.max(0, Math.min(100, patch.fullness)),
                // デバッグで空に戻した場合は、その項目のミッション進行もやり直せるようにする。
                ...(patch.fullness <= 0 ? { dailyFeedMissionComplete: false, dailyCareBonusAwarded: false, feedGrowthPointsToday: 0 } : {}),
              }
            : {}),
          ...(patch.viscosity !== undefined
            ? {
                viscosity: Math.max(0, Math.min(100, patch.viscosity)),
                ...(patch.viscosity <= 0 ? { dailyWaterMissionComplete: false, dailyCareBonusAwarded: false, waterGrowthPointsToday: 0 } : {}),
              }
            : {}),
        };
        void saveState(n);
        return n;
      });
    },
    []
  );

  const applyDebugAffection = useCallback((value: number) => {
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = { ...s, affection: Math.max(0, Math.floor(value)), affectionModelVersion: AFFECTION_MODEL_VERSION };
      void saveState(n);
      return n;
    });
  }, []);

  /** 開発用: なつき度は変えずに、その日の「なでる」回数だけを戻す。 */
  const resetDebugPetCount = useCallback(() => {
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = {
        ...s,
        petNormalCountToday: 0,
        petCountToday: 0,
        dailyPetMissionComplete: false,
        dailyPetBonusClaimed: false,
        dailyPetBonusUsesRemaining: 0,
        dailyPetBonusUsed: false,
      };
      void saveState(n);
      return n;
    });
  }, []);

  const resetDebugDailyMissions = useCallback(() => {
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = resetDailyMissionsForDebug(s, getNow());
      void saveState(n);
      return n;
    });
  }, [getNow]);

  const claimDailyMissionReward = useCallback(() => {
    if (!state || state.condition === 'dead') return;
    const preview = claimDailyCareMissionReward(state, getNow());
    if (!preview.claimed) return;
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const claim = claimDailyCareMissionReward(s, getNow());
      if (!claim.claimed) return s;
      pendingGrowthPointGainRef.current = { amount: 1, source: 'mission' };
      void saveState(claim.state);
      return claim.state;
    });
    setMissionOpen(false);
    setPendingMissionRewardPopup({ kind: 'care' });
  }, [state, getNow]);

  const claimDailyPetMission = useCallback(() => {
    if (!state || state.condition === 'dead') return;
    const preview = claimDailyPetMissionReward(state, getNow());
    if (!preview.claimed) return;
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const claim = claimDailyPetMissionReward(s, getNow());
      if (!claim.claimed) return s;
      void saveState(claim.state);
      return claim.state;
    });
    setMissionOpen(false);
    setPendingMissionRewardPopup({ kind: 'pet' });
  }, [state, getNow]);

  const claimGrowthMission = useCallback((cm: number) => {
    if (!state || state.condition === 'dead') return;
    const preview = claimGrowthMissionReward(state, cm);
    if (!preview.claimed) return;
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const claim = claimGrowthMissionReward(s, cm);
      if (!claim.claimed) return s;
      pendingGrowthPointGainRef.current = claim.directPoints > 0 ? { amount: claim.directPoints, source: 'mission' } : null;
      void saveState(claim.state);
      return claim.state;
    });
    setMissionOpen(false);
    // 種類と報酬量を同時にセットし、既定の「お世話」文言が一瞬出ないようにする。
    setPendingMissionRewardPopup({ kind: 'growth', amount: preview.amount, directPoints: preview.directPoints, reward: preview.reward });
  }, [state]);

  /** 開発用: 死亡画面と再スタート導線をすぐ確認できるようにする。 */
  const applyDebugDeadState = useCallback(() => {
    setParticles([]);
    setTapRipples([]);
    setCelebrationQueue([]);
    setCelebrationItem(null);
    setOfflineBacklogPageQueue([]);
    offlineBacklogModalMetaRef.current = null;
    void clearPredictiveGaugeAlerts();
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = {
        ...s,
        condition: 'dead' as const,
        latestLog: '静かな川の流れだけが残っています。',
      };
      void saveState(n);
      return n;
    });
  }, []);

  const spawnBurst = useCallback((kind: PfxKind) => {
    const isBonus = kind === 'bonusFeed' || kind === 'bonusWater' || kind === 'bonusPet';
    const count = isBonus ? 4 : 3;
    const batch: FallingPfx[] = [];
    for (let i = 0; i < count; i++) {
      const base = kind === 'feed' || kind === 'bonusFeed' || kind === 'bonusPet' ? 38 : 40;
      const size = base + Math.floor(Math.random() * 20);
      const isWater = kind === 'water' || kind === 'bonusWater';
      batch.push({
        id: ++particleSerial.current,
        kind,
        leftPct: 6 + Math.random() * 88,
        size,
        drift: (Math.random() - 0.5) * (isWater ? 14 : kind === 'bonusPet' ? 34 : 56),
        delayMs: Math.floor(Math.random() * 500),
        durationMs: isWater
          ? 6500 + Math.floor(Math.random() * 2000)
          : isBonus ? 5200 + Math.floor(Math.random() * 1800) : 4200 + Math.floor(Math.random() * 1800),
        spinFromDeg: (Math.random() - 0.5) * (isWater ? 6 : kind === 'bonusPet' ? 12 : 22),
        spinToDeg: isWater ? 25 + Math.random() * 35 : kind === 'bonusPet' ? 30 + Math.random() * 55 : 100 + Math.random() * 120,
      });
    }
    const ids = batch.map((b) => b.id);
    const maxLife = Math.max(...batch.map((b) => b.delayMs + b.durationMs), 0) + 250;
    setParticles((p) => [...p, ...batch]);
    setTimeout(() => {
      setParticles((p) => p.filter((x) => !ids.includes(x.id)));
    }, maxLife);
  }, []);

  const onFeed = useCallback(() => {
    if (!state || state.condition === 'dead') return;
    setInitialCareGuide((guide) => guide.feed ? { ...guide, feed: false } : guide);
    if ((state.bonusFeedCare ?? 0) > 0) {
      spawnBurst('bonusFeed');
      setState((s) => {
        if (!s || s.condition === 'dead') return s;
        const bonus = applyGrowthMissionBonusCare(s, 'feed');
        if (!bonus.used) return s;
        pendingGrowthPointGainRef.current = { amount: 1, source: 'feed' };
        void saveState(bonus.state);
        return bonus.state;
      });
      showCareSpeech('ごほうびごはん、おいしいね！ 体長 +1pt');
      return;
    }
    // 満タンでも、かわいがった反応としてごはんの演出は見せる。
    spawnBurst('feed');
    // 満タン時だけは演出のみ。90〜99%なら、ptなしで満タンまで回復できる。
    if (state.fullness >= 99.5) {
      showCareSpeech(Math.random() < 0.5 ? 'いまはおなかいっぱい〜' : 'もう少しおなかがすいたら食べようね');
      return;
    }
    const preview = applyCareAction(state, 'feed', getNow());
    if (
      preview.state.dailyFeedMissionComplete &&
      preview.state.dailyWaterMissionComplete &&
      !(state.dailyFeedMissionComplete && state.dailyWaterMissionComplete)
    ) {
      showCareSpeech('お世話ミッション達成！ ミッションで報酬を受け取ってね');
    }
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const care = applyCareAction(s, 'feed', getNow());
      const growthPointAmount = care.growthPointsEarned + (care.dailyBonusEarned ? 1 : 0);
      pendingGrowthPointGainRef.current =
        growthPointAmount > 0
          ? { amount: growthPointAmount, source: care.dailyBonusEarned ? 'mission' : 'feed' }
          : null;
      void saveState(care.state);
      return care.state;
    });
  }, [state, showCareSpeech, spawnBurst, getNow]);

  const onWater = useCallback(() => {
    if (!state || state.condition === 'dead') return;
    setInitialCareGuide((guide) => guide.water ? { ...guide, water: false } : guide);
    if ((state.bonusWaterCare ?? 0) > 0) {
      spawnBurst('bonusWater');
      setState((s) => {
        if (!s || s.condition === 'dead') return s;
        const bonus = applyGrowthMissionBonusCare(s, 'water');
        if (!bonus.used) return s;
        pendingGrowthPointGainRef.current = { amount: 1, source: 'water' };
        void saveState(bonus.state);
        return bonus.state;
      });
      showCareSpeech('きらきら湧き水だ！ 体長 +1pt');
      return;
    }
    // 満タンでも、かわいがった反応としておみずの演出は見せる。
    spawnBurst('water');
    // 満タン時だけは演出のみ。90〜99%なら、ptなしで満タンまで回復できる。
    if (state.viscosity >= 99.5) {
      showCareSpeech(Math.random() < 0.5 ? 'いまはぬめぬめ、ばっちり！' : 'もう少し乾いたらおみずをもらおうね');
      return;
    }
    const preview = applyCareAction(state, 'water', getNow());
    if (
      preview.state.dailyFeedMissionComplete &&
      preview.state.dailyWaterMissionComplete &&
      !(state.dailyFeedMissionComplete && state.dailyWaterMissionComplete)
    ) {
      showCareSpeech('お世話ミッション達成！ ミッションで報酬を受け取ってね');
    }
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const care = applyCareAction(s, 'water', getNow());
      const growthPointAmount = care.growthPointsEarned + (care.dailyBonusEarned ? 1 : 0);
      pendingGrowthPointGainRef.current =
        growthPointAmount > 0
          ? { amount: growthPointAmount, source: care.dailyBonusEarned ? 'mission' : 'water' }
          : null;
      void saveState(care.state);
      return care.state;
    });
  }, [state, showCareSpeech, spawnBurst, getNow]);

  // 画像とGIFをプリロード
  useEffect(() => {
    const loadAssets = async () => {
      try {
        if (Platform.OS !== 'web') {
          await Asset.loadAsync([
            require('./assets/images/kamogawa_tate2.png'),
            require('./assets/images/sansyo_toka2.gif'),
            ...ADULT_WALK_FRAMES,
            require('./assets/images/esa.png'),
            require('./assets/images/mizu.png'),
          ]);
        }
        setImagesLoaded(true);
      } catch (error) {
        console.error('Failed to load assets:', error);
        setImagesLoaded(true); // エラーでも続行
      }
    };
    loadAssets();
  }, []);

  // 成体は移動中だけ動画由来のPNG連番をゆっくり進める。停止時は最後の姿勢を保つ。
  useEffect(() => {
    if (!isAdultForAnimation || !isOosanWalking) return;

    const timer = setInterval(() => {
      setAdultWalkFrameIndex((index) => (index + 1) % ADULT_WALK_FRAMES.length);
    }, 170);
    return () => clearInterval(timer);
  }, [isAdultForAnimation, isOosanWalking]);

  // 初回マウント時に状態を読み込む
  useEffect(() => {
    const initializeState = async () => {
      const hadSavedState = (await AsyncStorage.getItem(STORAGE_KEY)) != null;
      let loadedState = await loadState();
      if (DEBUG_FORCE_MAX_OOSAN_LENGTH) {
        loadedState = {
          ...loadedState,
          growthAnchorMs: Date.now() - MS_TO_REACH_TARGET_LENGTH,
          bodyLengthCm: GROWTH_TARGET_CM,
        };
      } else if (DEBUG_RESET_GROWTH_PROGRESS_ONCE) {
        const resetNow = Date.now();
        loadedState = {
          ...loadedState,
          growthAnchorMs: resetNow,
          bodyLengthCm: 0,
          lastGrowthTickMs: resetNow,
          claimedMilestoneIds: [],
          sessionForegroundMs: 0,
        };
      }
      const now = Date.now();
      const today = new Date().toISOString().split('T')[0];
      const daysSinceLastVisit = getDaysDiff(loadedState.lastVisitDate, today);
      let updatedState = loadedState;
      if (!DEBUG_FORCE_MAX_OOSAN_LENGTH) {
        updatedState = applyOfflineCatchUp(
          updatedState,
          now,
          FULLNESS_DECAY_PER_SECOND,
          VISCOSITY_DECAY_PER_SECOND
        );
      } else {
        updatedState = { ...updatedState, lastGrowthTickMs: now };
      }
      // 状態を更新
      updatedState = processCondition(updatedState);
      
      // 日次ログを生成
      const newLog =
        updatedState.condition !== 'dead' && daysSinceLastVisit >= DAYS_UNTIL_INACTIVITY_REMINDER
          ? 'しばらく会えていませんでした。会いにきてくれてありがとう。'
          : generateDailyLog(updatedState);
      if (updatedState.lastVisitDate === today) {
        updatedState.latestLog = newLog;
      }

      setState(updatedState);
      await saveState(updatedState);
      if (!hadSavedState) setNewOosanGuideOpen(true);
    };

    initializeState();
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // 20cmをまたいだその場だけ、成体になったことを大きく祝う。
  // 初回読込時は基準値だけ覚えるため、既存の成体セーブで突然出ることはない。
  useEffect(() => {
    if (!state) return;
    const current = state.bodyLengthCm;
    const previous = previousBodyLengthRef.current;
    previousBodyLengthRef.current = current;
    if (previous == null || state.condition === 'dead') return;
    if (previous < ADULT_OOSAN_MIN_LENGTH_CM && current >= ADULT_OOSAN_MIN_LENGTH_CM) {
      queueCelebrationPopup({ kind: 'adult' });
      return;
    }
    const crossed = GROWTH_STAGES.filter(
      (stage) => stage.cm !== ADULT_OOSAN_MIN_LENGTH_CM && previous < stage.cm && current >= stage.cm
    );
    const newest = crossed[crossed.length - 1];
    if (newest) {
      showGrowthStageNotice(newest);
      return;
    }
    // 成長表の節目でなくても、整数cmをまたいだら通常の成長ポップアップを出す。
    const previousWholeCm = Math.floor(previous);
    const currentWholeCm = Math.floor(current);
    if (currentWholeCm >= 1 && currentWholeCm > previousWholeCm) {
      queueCelebrationPopup({ kind: 'length', data: { cm: currentWholeCm, bodyLengthCm: current } });
    }
  }, [state?.bodyLengthCm, state?.condition, queueCelebrationPopup, showGrowthStageNotice]);

  // ゲージ満タンの演出を見せてから、すべてのなつきLvアップをお祝いする。
  useEffect(() => {
    if (!state) return;
    const currentLevel = affectionLevelForValue(state.affection ?? 0);
    const previousLevel = previousAffectionLevelRef.current;
    previousAffectionLevelRef.current = currentLevel;
    if (previousLevel == null || currentLevel <= previousLevel) return;
    const celebration = { level: currentLevel, name: affectionStageForLevel(currentLevel).name };
    if (affectionGaugeCelebrationTimerRef.current) clearTimeout(affectionGaugeCelebrationTimerRef.current);
    setAffectionGaugeCelebration(celebration);
    affectionGaugeCelebrationTimerRef.current = setTimeout(() => {
      setAffectionGaugeCelebration(null);
      queueCelebrationPopup({ kind: 'affection', data: celebration });
      affectionGaugeCelebrationTimerRef.current = null;
    }, 950);
  }, [queueCelebrationPopup, state?.affection]);

  /** ミッション一覧の fade 後に報酬を表示し、native Modal を重ねない。 */
  useEffect(() => {
    if (!pendingMissionRewardPopup || missionOpen || dailyMissionRewardPopup != null || hasActiveCelebrationPopup) return;
    const reward = pendingMissionRewardPopup;
    const timer = setTimeout(() => {
      setDailyMissionRewardPopup(reward);
      setPendingMissionRewardPopup(null);
    }, 220);
    return () => clearTimeout(timer);
  }, [dailyMissionRewardPopup, hasActiveCelebrationPopup, missionOpen, pendingMissionRewardPopup]);

  /** 報酬を閉じた後に、待機していた成長・なつき度演出を必ず一枚ずつ開く。 */
  useEffect(() => {
    if (dailyMissionRewardPopup != null || pendingMissionRewardPopup != null || hasActiveCelebrationPopup) return;
    if (queuedCelebrationPopups.length === 0) return;
    const [next, ...rest] = queuedCelebrationPopups;
    setQueuedCelebrationPopups(rest);
    showCelebrationPopup(next);
  }, [dailyMissionRewardPopup, hasActiveCelebrationPopup, pendingMissionRewardPopup, queuedCelebrationPopups, showCelebrationPopup]);
  useEffect(() => {
    const pending = pendingGrowthPointGainRef.current;
    if (!pending) return;
    pendingGrowthPointGainRef.current = null;
    setGrowthPointGain({ id: ++growthPointGainSerial.current, ...pending });
  }, [state?.growthLevel, state?.growthPoints]);

  useEffect(() => {
    void prepareCareGaugeNotifications();
  }, []);

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      const prev = appStateSubRef.current;
      appStateSubRef.current = next;
      const s = stateRef.current;
      if (next === 'active') {
        void clearPredictiveGaugeAlerts();
      }
      if (!s || s.condition === 'dead') return;
      if (prev === 'active' && next !== 'active') {
        const atMs = Date.now() + timeOffsetRef.current;
        void schedulePredictiveGaugeAlerts(
          s,
          atMs,
          FULLNESS_DECAY_PER_SECOND,
          VISCOSITY_DECAY_PER_SECOND
        );
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!state || state.condition === 'dead') return;
    const vn = getNow();
    const n = computeIsNight(vn);
    if (nightRef.current !== n) {
      nightRef.current = n;
      Animated.timing(nightDim, {
        toValue: n ? 1 : 0,
        duration: 900,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [state?.condition, getNow, timeOffsetMs, debugNightCareMultiplier, nightDim]);

  useEffect(() => {
    if (!state?.latestLog) return;
    const useNativeDriver = Platform.OS !== 'web';
    const t = setTimeout(() => {
      dailyLogOpacity.setValue(0);
      Animated.timing(dailyLogOpacity, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }).start();
    }, 0);
    return () => clearTimeout(t);
  }, [state?.latestLog, dailyLogOpacity]);

  useEffect(() => {
    if (!state || state.condition === 'dead') return;
    const id = setInterval(() => {
      setState((prev) => {
        if (!prev || prev.condition === 'dead') return prev;
        const fj = sampleDecayJitter();
        const vj = sampleDecayJitter();
        const tickNow = Date.now() + timeOffsetRef.current;
        const gaugeDecayMult =
          RNAppState.currentState === 'active'
            ? GAUGE_DECAY_MULT_FOREGROUND
            : backgroundGaugeDecayMultiplier(prev, tickNow);
        const fullnessLoss = FULLNESS_DECAY_PER_SECOND * fj * gaugeDecayMult;
        const viscosityLoss = VISCOSITY_DECAY_PER_SECOND * vj * gaugeDecayMult;
        const next: AppState = {
          ...prev,
          fullness: Math.max(0, prev.fullness - fullnessLoss),
          viscosity: Math.max(0, prev.viscosity - viscosityLoss),
          lastGrowthTickMs: Date.now(),
        };
        void saveState(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state?.condition]);

  useEffect(() => {
    // 旧・時間成長用のマイルストーンは、育成レベル方式では使わない。
    // 保存済みの表示キューもここで閉じ、二重の達成演出を出さない。
    if (!state) return;
    if (offlineBacklogPageQueue.length > 0) setOfflineBacklogPageQueue([]);
    if (celebrationQueue.length > 0) setCelebrationQueue([]);
    if (celebrationItem != null) setCelebrationItem(null);
  }, [state, offlineBacklogPageQueue.length, celebrationQueue.length, celebrationItem]);

  useEffect(() => {
    if (celebrationItem !== null) return;
    if (celebrationQueue.length === 0) return;
    const [head, ...tail] = celebrationQueue;
    setCelebrationQueue(tail);
    setCelebrationItem(head);
  }, [celebrationItem, celebrationQueue]);

  useEffect(() => {
    if (!celebrationItem) return;
    const m = celebrationItem;
    if (m.tier === 'banner') {
      setBannerMsg(`1時間生存ボーナス！ ${m.name}`);
      bannerAnim.setValue(0);
      const anim = Animated.sequence([
        Animated.timing(bannerAnim, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.delay(3200),
        Animated.timing(bannerAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]);
      anim.start(({ finished }) => {
        if (finished) {
          setBannerMsg(null);
          commitClaimMilestone(m);
          setCelebrationItem(null);
        }
      });
      return () => anim.stop();
    }
    if (m.tier === 'low') {
      setSparkleActive(true);
    }
    if (m.tier === 'high') {
      void runConfettiBurst();
    }
    return undefined;
  }, [celebrationItem, bannerAnim, commitClaimMilestone]);

  const getWanderBounds = useCallback(() => {
    const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
    const oosanWidth = oosanLayoutSizeRef.current;
    const isSmall = oosanLengthCmRef.current <= 50;
    const margin = 16;
    const fitOnScreenX = Math.max(0, screenWidth / 2 - oosanWidth / 2 - margin);
    const lateralWanderHalf = screenWidth * 1.22;
    const maxOffsetX = isSmall
      ? Math.max(24, fitOnScreenX * 0.9)
      : Math.max(fitOnScreenX, lateralWanderHalf);
    const minX = -maxOffsetX;
    const maxX = maxOffsetX;
    const minY = -screenHeight * 0.7;
    // 下方向の上限（translateY 正）。大きくしすぎると bottom 基準と相殺されて画面外に落ちる
    const maxY = isSmall ? screenHeight * 0.22 : screenHeight * 0.3;
    return { minX, maxX, minY, maxY, screenWidth, screenHeight };
  }, []);

  // オオサンショウウオのうろうろアニメーション（50cm 以下はゆっくり・画面内に収め、それ以上は広く動ける）
  useEffect(() => {
    const moveOosan = () => {
      const genAtStart = wanderGenRef.current;
      const { minX, maxX, minY, maxY } = getWanderBounds();
      /** 0〜1 を中央付近に寄せる（3 回平均 → 真ん中にいる確率が高い） */
      const randCenterBiased = () =>
        (Math.random() + Math.random() + Math.random()) / 3;
      const targetX = minX + randCenterBiased() * (maxX - minX);

      const currentY = (oosanYAnim as any)._value || 0;
      if (currentY === 0) {
        oosanYAnim.setValue((minY + maxY) / 2);
      }

      const targetY = minY + randCenterBiased() * (maxY - minY);

      const isSmall = oosanLengthCmRef.current <= 50;
      const moveDuration = isSmall
        ? 9500 + Math.random() * 7000
        : 5000 + Math.random() * 5000;

      const waitDuration = isSmall
        ? Math.random() < 0.2
          ? 12000 + Math.random() * 6000
          : 2000 + Math.random() * 4000
        : Math.random() < 0.2
          ? 10000 + Math.random() * 5000
          : 1000 + Math.random() * 3000;

      const useNativeDriver = Platform.OS !== 'web';

      const currentX = (oosanXAnim as any)._value || 0;
      setIsMovingRight(targetX > currentX);
      setIsOosanWalking(true);

      Animated.parallel([
        Animated.timing(oosanXAnim, {
          toValue: targetX,
          duration: moveDuration,
          useNativeDriver,
        }),
        Animated.timing(oosanYAnim, {
          toValue: targetY,
          duration: moveDuration,
          useNativeDriver,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setIsOosanWalking(false);
        if (wanderGenRef.current !== genAtStart) return;

        const resumeWander = () => {
          if (wanderGenRef.current !== genAtStart) return;
          moveOosan();
        };
        // ときどき位置をほぼ変えずに、少しだけ足をばたつかせる。
        if (Math.random() < 0.35) {
          const beforeFidgetDelay = Math.max(350, waitDuration * 0.35);
          Animated.delay(beforeFidgetDelay).start(({ finished: delayDone }) => {
            if (!delayDone || wanderGenRef.current !== genAtStart) return;
            const idleX = (oosanXAnim as any)._value || 0;
            const idleY = (oosanYAnim as any)._value || 0;
            const fidgetDistance = isSmall ? 14 : 26;
            const fidgetX = Math.max(
              minX,
              Math.min(maxX, idleX + (Math.random() < 0.5 ? -fidgetDistance : fidgetDistance))
            );
            const fidgetY = Math.max(
              minY,
              Math.min(maxY, idleY + (Math.random() - 0.5) * fidgetDistance * 0.35)
            );
            setIsMovingRight(fidgetX > idleX);
            setIsOosanWalking(true);
            Animated.parallel([
              Animated.sequence([
                Animated.timing(oosanXAnim, { toValue: fidgetX, duration: 420, useNativeDriver }),
                Animated.timing(oosanXAnim, { toValue: idleX, duration: 480, useNativeDriver }),
              ]),
              Animated.sequence([
                Animated.timing(oosanYAnim, { toValue: fidgetY, duration: 420, useNativeDriver }),
                Animated.timing(oosanYAnim, { toValue: idleY, duration: 480, useNativeDriver }),
              ]),
            ]).start(({ finished: fidgetDone }) => {
              if (!fidgetDone || wanderGenRef.current !== genAtStart) return;
              setIsOosanWalking(false);
              Animated.delay(Math.max(0, waitDuration - beforeFidgetDelay)).start(({ finished: waitDone }) => {
                if (!waitDone) return;
                resumeWander();
              });
            });
          });
        } else {
          Animated.delay(waitDuration).start(({ finished: waitDone }) => {
            if (!waitDone) return;
            resumeWander();
          });
        }
      });
    };

    moveOosanRef.current = moveOosan;
    moveOosan();

    return () => {
      wanderGenRef.current += 1;
      oosanXAnim.stopAnimation();
      oosanYAnim.stopAnimation();
    };
  }, [getWanderBounds, oosanXAnim, oosanYAnim]);

  const maybePetOnPress = useCallback((isBonus = false) => {
    if (!state || state.condition !== 'healthy') return;
    setIsPetting(true);
    setIsBonusPetting(isBonus);
    const useNativeDriver = Platform.OS !== 'web';
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.05,
        duration: 200,
        useNativeDriver,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver,
      }),
      // ごほうび時は、ゆっくり大きくなる金色ハートが消えるまで表示を保つ。
      Animated.delay(isBonus ? 2300 : 1500),
    ]).start(() => {
      setIsPetting(false);
      setIsBonusPetting(false);
    });
  }, [state, scaleAnim]);

  /** 体を直接なでた時は、顔を中央寄りへ戻して目を合わせられるようにする。 */
  const bringFaceIntoView = useCallback(() => {
    if (oosanLengthCmRef.current < ADULT_OOSAN_MIN_LENGTH_CM) return;
    wanderGenRef.current += 1;
    const generation = wanderGenRef.current;
    oosanXAnim.stopAnimation();
    oosanYAnim.stopAnimation();
    const currentX = (oosanXAnim as any)._value || 0;
    const currentY = (oosanYAnim as any)._value || 0;
    // 画面中央側を向かせ、顔の位置（中心から約37%）が中央に来るようにする。
    const faceRight = currentX <= 0;
    const faceOffset = oosanLayoutSizeRef.current * 0.37;
    const { minX, maxX, minY, maxY } = getWanderBounds();
    const targetX = Math.max(minX, Math.min(maxX, faceRight ? -faceOffset : faceOffset));
    const targetY = Math.max(minY, Math.min(maxY, currentY));
    setIsMovingRight(faceRight);
    setIsOosanWalking(true);
    Animated.parallel([
      Animated.timing(oosanXAnim, { toValue: targetX, duration: 760, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(oosanYAnim, { toValue: targetY, duration: 760, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    ]).start(({ finished }) => {
      setIsOosanWalking(false);
      if (finished && wanderGenRef.current === generation) moveOosanRef.current?.();
    });
  }, [getWanderBounds, oosanXAnim, oosanYAnim]);

  const onPet = useCallback((showLimitSpeech = false) => {
    if (!state || state.condition !== 'healthy') return;
    const preview = applyCareAction(state, 'pet', getNow());
    const isDirectTap = !showLimitSpeech;
    const bonusUsesRemaining = state.dailyPetBonusUsesRemaining ?? (
      state.dailyPetBonusClaimed === true && state.dailyPetBonusUsed !== true ? 1 : 0
    );
    const isBonusPet = bonusUsesRemaining > 0;
    // なつき度の上限後でも、触れた反応としてハートは毎回出す。
    maybePetOnPress(isBonusPet);
    if (isBonusPet) {
      spawnBurst('bonusPet');
      showCareSpeech('ごほうびなでなで！ もっとなかよしになったよ');
    }
    if (isDirectTap) bringFaceIntoView();
    const madePetProgress = (preview.state.petCountToday ?? 0) !== (state.petCountToday ?? 0);
    const justCompletedMission = preview.state.dailyPetMissionComplete && !state.dailyPetMissionComplete;
    if (showLimitSpeech && justCompletedMission) {
      showCareSpeech('なかよしミッション達成！ ミッションで報酬を受け取ってね');
    } else if (showLimitSpeech && state.dailyPetMissionComplete && !state.dailyPetBonusClaimed) {
      showCareSpeech('ミッションで、ごほうびなでなでを受け取ってね');
    } else if (showLimitSpeech && !madePetProgress) {
      showCareSpeech(Math.random() < 0.5 ? '今日はたくさんなでてもらったよ〜' : 'うれしいな、また明日ね');
    }
    if (madePetProgress) {
      setState((s) => {
        if (!s || s.condition !== 'healthy') return s;
        const care = applyCareAction(s, 'pet', getNow());
        const next = {
          ...care.state,
          latestLog: isDirectTap ? pickOosanMessage(care.state) : pickTapMessage(care.state),
        };
        void saveState(next);
        return next;
      });
    } else if (isDirectTap || showLimitSpeech) {
      setState((s) => {
        if (!s || s.condition !== 'healthy') return s;
        const next = { ...s, latestLog: isDirectTap ? pickOosanMessage(s) : pickTapMessage(s) };
        void saveState(next);
        return next;
      });
    }
  }, [state, maybePetOnPress, bringFaceIntoView, getNow, showCareSpeech, spawnBurst]);

  /** 短いタップはなでる、指を動かした時だけオオサンショウウオが指についてくる。 */
  const beginOosanDrag = useCallback((e: GestureResponderEvent) => {
    if (!state || state.condition === 'dead') return;
    consumeOosanTouchRef.current = true;
    setIsOosanDragging(true);
    wanderGenRef.current += 1;
    const generation = wanderGenRef.current;
    oosanXAnim.stopAnimation();
    oosanYAnim.stopAnimation();
    oosanDragRef.current = {
      pageX: e.nativeEvent.pageX,
      pageY: e.nativeEvent.pageY,
      x: (oosanXAnim as any)._value || 0,
      y: (oosanYAnim as any)._value || 0,
      moved: false,
      generation,
    };
  }, [state, oosanXAnim, oosanYAnim]);

  const moveOosanWithFinger = useCallback((e: GestureResponderEvent) => {
    const drag = oosanDragRef.current;
    if (!drag) return;
    const dx = e.nativeEvent.pageX - drag.pageX;
    const dy = e.nativeEvent.pageY - drag.pageY;
    if (Math.hypot(dx, dy) > 7) drag.moved = true;
    if (!drag.moved) return;
    const { minX, maxX, minY, maxY } = getWanderBounds();
    const nextX = Math.max(minX, Math.min(maxX, drag.x + dx));
    const nextY = Math.max(minY, Math.min(maxY, drag.y + dy));
    if (Math.abs(dx) > 1) setIsMovingRight(dx > 0);
    setIsOosanWalking(true);
    oosanXAnim.setValue(nextX);
    oosanYAnim.setValue(nextY);
  }, [getWanderBounds, oosanXAnim, oosanYAnim]);

  const endOosanDrag = useCallback(() => {
    const drag = oosanDragRef.current;
    oosanDragRef.current = null;
    setIsOosanDragging(false);
    if (!drag) return;
    // 親の背景タップが同じタッチとして後から届く場合だけ無視し、次の通常タップには影響させない。
    setTimeout(() => { consumeOosanTouchRef.current = false; }, 0);
    if (!drag.moved) {
      onPet(false);
      return;
    }
    setIsOosanWalking(false);
    // 指を離して少し落ち着いてから、いつものゆっくりした自動遊泳へ戻る。
    setTimeout(() => {
      if (wanderGenRef.current === drag.generation) moveOosanRef.current?.();
    }, 850);
  }, [onPet]);

  /** タップ位置へ向きを合わせて移動し、その後また自動うろうろへ */
  const handleContainerPress = useCallback(
    (e: GestureResponderEvent) => {
      if (consumeOosanTouchRef.current) {
        consumeOosanTouchRef.current = false;
        return;
      }
      if (!state || state.condition === 'dead') return;
      if (state.condition !== 'healthy' && state.condition !== 'weak') return;

      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

      const runTapMove = (tapNormX: number, tapNormY: number, rippleX: number, rippleY: number) => {
        const rid = ++tapRippleSerial.current;
        setTapRipples((list) => [...list, { id: rid, x: rippleX, y: rippleY }]);
        wanderGenRef.current += 1;
        const genAfterBump = wanderGenRef.current;
        oosanXAnim.stopAnimation();
        oosanYAnim.stopAnimation();
        const currentX = (oosanXAnim as any)._value || 0;
        const currentY = (oosanYAnim as any)._value || 0;
        const { minX, maxX, minY, maxY } = getWanderBounds();
        // タップ地点へ胴体の中心を置くのではなく、進行方向側の顔を近づける。
        // 大きく育ったあとも、顔が画面外へ逃げずに触れ合えるようにする。
        const desiredFaceX = minX + tapNormX * (maxX - minX);
        const desiredFaceY = minY + tapNormY * (maxY - minY);
        const movingRight = desiredFaceX > currentX;
        const bodySize = oosanLayoutSizeRef.current;
        const faceOffset = bodySize * (oosanLengthCmRef.current >= ADULT_OOSAN_MIN_LENGTH_CM ? 0.37 : 0.25);
        const targetX = Math.max(
          minX,
          Math.min(maxX, desiredFaceX - (movingRight ? faceOffset : -faceOffset))
        );
        const targetY = Math.max(minY, Math.min(maxY, desiredFaceY));
        setIsMovingRight(movingRight);
        setIsOosanWalking(true);
        const useNativeDriver = Platform.OS !== 'web';
        const dist = Math.hypot(targetX - currentX, targetY - currentY);
        const duration = Math.round(
          Math.min(5400, Math.max(2000, 1250 + dist * 24 + Math.random() * 380))
        );
        const tapEase = Easing.inOut(Easing.cubic);
        Animated.parallel([
          Animated.timing(oosanXAnim, {
            toValue: targetX,
            duration,
            easing: tapEase,
            useNativeDriver,
          }),
          Animated.timing(oosanYAnim, {
            toValue: targetY,
            duration,
            easing: tapEase,
            useNativeDriver,
          }),
        ]).start(({ finished }) => {
          if (!finished || wanderGenRef.current !== genAfterBump) return;
          moveOosanRef.current?.();
        });
      };

      const node = mainPressableRef.current as View & {
        measureInWindow?: (
          cb: (x: number, y: number, w: number, h: number) => void
        ) => void;
      };
      if (typeof node?.measureInWindow === 'function') {
        node.measureInWindow((winX, winY, winW, winH) => {
          const relX = pageX - winX;
          const relY = pageY - winY;
          const tapNormX = clamp01(relX / Math.max(1, winW));
          const tapNormY = clamp01(relY / Math.max(1, winH));
          runTapMove(tapNormX, tapNormY, relX, relY);
        });
      } else {
        const { screenWidth, screenHeight } = getWanderBounds();
        const tapNormX = clamp01(locationX / Math.max(1, screenWidth));
        const tapNormY = clamp01(locationY / Math.max(1, screenHeight));
        runTapMove(tapNormX, tapNormY, locationX, locationY);
      }
    },
    [state, getWanderBounds, oosanXAnim, oosanYAnim]
  );


  if (!state) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const lengthCm = Math.max(0, state.bodyLengthCm);
  const claimedGrowthMissionIds = new Set(state.claimedGrowthMissionIds ?? []);
  // 段階名だけの行（25cmなど）は案内表には残すが、成長ミッションにはしない。
  const growthMissionStages = GROWTH_STAGES.filter(
    (stage) => stage.cm >= 1 && growthMissionRewardKindForCm(stage.cm) !== 'none'
  );
  const availableGrowthMission = growthMissionStages.find(
    (stage) => lengthCm + 1e-9 >= stage.cm && !claimedGrowthMissionIds.has(growthMissionIdForCm(stage.cm))
  );
  const nextGrowthMission = growthMissionStages.find((stage) => stage.cm > lengthCm + 1e-9);
  const displayedGrowthMission = availableGrowthMission ?? nextGrowthMission;
  const isAdultOosan = lengthCm >= ADULT_OOSAN_MIN_LENGTH_CM;
  const lengthCmText = lengthCm.toFixed(1);
  const growthLevel = state.growthLevel ?? 1;
  const growthPoints = state.growthPoints ?? 0;
  const growthPointsNeeded = growthPointsRequiredForLevel(growthLevel);
  const bonusFeedCare = state.bonusFeedCare ?? 0;
  const bonusWaterCare = state.bonusWaterCare ?? 0;
  const initialFeedCareGuide = initialCareGuide.feed;
  const initialWaterCareGuide = initialCareGuide.water;
  const feedGrowthPointsToday = state.feedGrowthPointsToday ?? 0;
  const waterGrowthPointsToday = state.waterGrowthPointsToday ?? 0;
  const dailyCarePointCap = dailyCareGrowthPointCapForLevel(growthLevel);
  const feedDailyPointCapReached = feedGrowthPointsToday >= dailyCarePointCap;
  const waterDailyPointCapReached = waterGrowthPointsToday >= dailyCarePointCap;
  const feedPointReward = careGrowthPointsForGauge(state.fullness, growthLevel);
  const waterPointReward = careGrowthPointsForGauge(state.viscosity, growthLevel);
  const canEarnFeedPoint = feedPointReward > 0 && !feedDailyPointCapReached && growthPointsNeeded > 0;
  const canEarnWaterPoint = waterPointReward > 0 && !waterDailyPointCapReached && growthPointsNeeded > 0;
  const feedPointWait = growthPointWaitLabel(state.fullness, FULLNESS_SECONDS_PER_ONE_PERCENT);
  const waterPointWait = growthPointWaitLabel(state.viscosity, VISCOSITY_SECONDS_PER_ONE_PERCENT);
  const dailyFeedMissionComplete = state.dailyFeedMissionComplete === true;
  const dailyWaterMissionComplete = state.dailyWaterMissionComplete === true;
  const dailyPetMissionComplete = state.dailyPetMissionComplete === true;
  const dailyPetBonusClaimed = state.dailyPetBonusClaimed === true;
  const dailyPetBonusUsed = state.dailyPetBonusUsed === true;
  const dailyCareBonusAwarded = state.dailyCareBonusAwarded === true;
  const dailyCareMissionComplete = dailyFeedMissionComplete && dailyWaterMissionComplete;
  const dailyCareRewardAvailable = dailyCareMissionComplete && !dailyCareBonusAwarded;
  const affection = state.affection ?? 0;
  const normalPetLimit = dailyPetNormalLimitForAffectionValue(affection);
  const petNormalCount = Math.min(normalPetLimit, state.petNormalCountToday ?? Math.min(state.petCountToday ?? 0, normalPetLimit));
  const petRewardAvailable = dailyPetMissionComplete && !dailyPetBonusClaimed && !dailyPetBonusUsed;
  const petBonusUsesRemaining = Math.max(0, Math.min(DAILY_PET_BONUS_USES, state.dailyPetBonusUsesRemaining ?? (dailyPetBonusClaimed && !dailyPetBonusUsed ? 1 : 0)));
  const petBonusAvailable = petBonusUsesRemaining > 0;
  const canPetToday = petNormalCount < normalPetLimit || petBonusAvailable;
  const missionRewardAvailable = dailyCareRewardAvailable || petRewardAvailable || availableGrowthMission != null;
  const affectionLevel = affectionLevelForValue(affection);
  const displayedAffectionLevel = affectionGaugeCelebration
    ? Math.max(1, affectionGaugeCelebration.level - 1)
    : affectionLevel;
  const affectionProgress = affectionProgressForValue(affection);
  const affectionActionsInLevel = affectionProgress.progress;
  const affectionActionsNeeded = affectionProgress.required;
  const affectionLevelProgress =
    affectionGaugeCelebration ? 1 : affectionActionsNeeded > 0 ? affectionActionsInLevel / affectionActionsNeeded : 1;
  const affectionColor = affectionHeartColorForLevel(displayedAffectionLevel);
  const affectionProgressText =
    affectionGaugeCelebration
      ? '満タン！'
      : affectionActionsNeeded > 0
        ? `次のLvまで ${affectionActionsInLevel} / ${affectionActionsNeeded}回`
        : 'なかよし MAX';
  const virtualNow = getNow();
  const isNight = computeIsNight(virtualNow);
  const isMorningNatural = computeIsMorning(virtualNow);
  const isDaytimeNatural = computeIsDaytime(virtualNow);
  const hideNightForTimeDebug = DEBUG_FORCE_MORNING_UI || DEBUG_FORCE_DAY_UI;
  const showNightChrome = !hideNightForTimeDebug && isNight;
  const showMorningBadge =
    DEBUG_FORCE_MORNING_UI ||
    (!DEBUG_FORCE_DAY_UI && isMorningNatural && !isNight);
  const showDayBadge =
    DEBUG_FORCE_DAY_UI ||
    (!DEBUG_FORCE_MORNING_UI && isDaytimeNatural && !isNight);
  const phaseLabel = getGrowthPhaseLabel(lengthCm);
  // 夜間（logic.computeIsNight: 19〜6時）のみ nightDim=1。昼は 0 でベールは見えない。
  const nightOverlayOpacity = nightDim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.28],
  });
  const shortSide = Math.min(screenWidth, screenHeight);
  // 100cm 時: 短辺の約2倍幅。中央配置のためおおむね半分が画面外に出る目安（cm 表示とは別スケール）
  const oosanMaxWidthPx = shortSide * 2;
  const growthT = Math.min(1, lengthCm / DISPLAY_LENGTH_CAP_CM);
  const minOosanPx = Math.min(64, Math.max(48, shortSide * 0.14));
  const sizeMax = Math.max(minOosanPx, oosanMaxWidthPx);
  const size = minOosanPx + growthT * (sizeMax - minOosanPx);
  oosanLayoutSizeRef.current = size;
  oosanLengthCmRef.current = lengthCm;
  const opacity = state.condition === 'weak' ? 0.5 : 1.0;
  
  // 背景画像（Web版とアプリ版で分ける）
  const riverBackgroundSource = Platform.OS === 'web' 
    ? require('./assets/images/kamogawa_web.png')
    : require('./assets/images/kamogawa_tate2.png');
  // 1080×1920のアスペクト比（9:16）を保ちながら、画面全体を覆うようにスケール
  const imageAspectRatio = 1920 / 1080; // 約1.778
  // Webでは縦全体を表示、モバイルでは画面全体を覆うように計算
  const backgroundWidth = screenWidth;
  const backgroundHeight = Platform.OS === 'web' 
    ? screenHeight  // Webでは画面の高さに合わせる
    : Math.max(backgroundWidth * imageAspectRatio, screenHeight);  // モバイルではアスペクト比を保つ
  
  // 成長するほど下に寄せるが、translateY 最大時でも本体が見えるよう足元に下限を残す
  const oosanBottom =
    screenHeight * (0.3 * (1 - growthT) + 0.07 * growthT);
  

  return (
    <View style={styles.appRoot}>
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      scrollEnabled={!isOosanDragging}
    >
      <Pressable
        ref={mainPressableRef}
        style={styles.container}
        onPress={handleContainerPress}
      >
        {/* 川の背景 */}
        {imagesLoaded && (
          <Image
            source={riverBackgroundSource}
            style={[
              styles.riverBackground,
              {
                width: backgroundWidth,
                height: backgroundHeight,
              },
              ...(Platform.OS === 'web'
                ? ([{ imageRendering: 'high-quality', minHeight: screenHeight }] as any[])
                : ([] as const)),
            ]}
            resizeMode={Platform.OS === 'web' ? 'contain' : 'cover'}
          />
        )}

        {/* 夜間だけ川の上に薄いトーンを重ねる（DEBUG_FORCE_MORNING_UI 時は描画しない） */}
        {!hideNightForTimeDebug && (
          <Animated.View
            pointerEvents="none"
            style={[styles.nightVeil, { opacity: nightOverlayOpacity }]}
          />
        )}

        {state.condition !== 'dead' && showNightChrome && (
          <View style={styles.moonBadge} pointerEvents="none">
            <Ionicons name="moon" size={14} color="rgba(230, 240, 255, 0.92)" />
            <Text style={styles.moonBadgeLabel}>夜</Text>
          </View>
        )}

        {state.condition !== 'dead' && showMorningBadge && (
          <View style={styles.sunBadge} pointerEvents="none">
            <Ionicons name="sunny" size={14} color="rgba(255, 248, 220, 0.98)" />
            <Text style={styles.sunBadgeLabel}>朝</Text>
          </View>
        )}

        {state.condition !== 'dead' && showDayBadge && (
          <View style={styles.dayBadge} pointerEvents="none">
            <Ionicons name="partly-sunny" size={14} color="rgba(255, 252, 235, 0.96)" />
            <Text style={styles.dayBadgeLabel}>昼</Text>
          </View>
        )}

        {state.condition !== 'dead' && (
          <LevelProgressOrb
            cmText={lengthCmText}
            bodyLengthCm={lengthCm}
            points={growthPoints}
            pointsNeeded={growthPointsNeeded}
            onPress={() => setGrowthGuideOpen(true)}
            pointGain={growthPointGain}
          />
        )}

        {growthPointGain && (
          <GrowthPointFlight
            key={growthPointGain.id}
            gain={growthPointGain}
            screenWidth={screenWidth}
            screenHeight={screenHeight}
          />
        )}

        {state.condition !== 'dead' && (
          <View
            style={styles.phaseBadge}
          >
            <Text style={styles.phaseBadgeText}>{phaseLabel}</Text>
          </View>
        )}

        {state.condition !== 'dead' && (
          <Pressable
            style={styles.nameBadge}
            onPress={(event) => {
              event.stopPropagation();
              openNameEditor();
            }}
            accessibilityRole="button"
            accessibilityLabel="オオサンショウウオの名前を変更する"
          >
            <Ionicons name="pencil" size={12} color="#effbff" />
            <Text numberOfLines={2} style={styles.nameBadgeText}>{state.oosanName ?? DEFAULT_OOSAN_NAME}</Text>
          </Pressable>
        )}

        {tapRipples.length > 0 && (
          <View style={styles.tapRippleLayer} pointerEvents="none">
            {tapRipples.map((r) => (
              <TapWaterRipple
                key={r.id}
                x={r.x}
                y={r.y}
                rippleId={r.id}
                onRemove={removeTapRipple}
              />
            ))}
          </View>
        )}

        {/* オオサンショウウオ */}
        {state.condition !== 'dead' && (
          <Animated.View
            style={[
              styles.oosanContainer,
              {
                bottom: oosanBottom,
                transform: [
                  { scale: scaleAnim },
                  { translateX: oosanXAnim },
                  { translateY: oosanYAnim },
                ],
                opacity: opacity,
              },
            ]}
          >
            {imagesLoaded && (
              <View
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onMoveShouldSetResponderCapture={() => true}
                onResponderGrant={beginOosanDrag}
                onResponderMove={moveOosanWithFinger}
                onResponderRelease={endOosanDrag}
                onResponderTerminate={endOosanDrag}
                onResponderTerminationRequest={() => false}
                accessibilityRole="button"
                accessibilityLabel="オオサンショウウオをなでる、または指で動かす"
                style={styles.oosanTouchArea}
              >
                <ExpoImage
                  source={
                    isAdultOosan
                      ? ADULT_WALK_FRAMES[adultWalkFrameIndex]
                      : require('./assets/images/sansyo_toka2.gif')
                  }
                  style={[
                    styles.oosan,
                    { width: size, height: isAdultOosan ? size * 0.55 : size * 0.8 },
                    isMovingRight && { transform: [{ scaleX: -1 }] },
                  ]}
                  contentFit="contain"
                />
              </View>
            )}
            {careSpeech && (
              <View style={[styles.careSpeechBubble, { bottom: isAdultOosan ? size * 0.42 : size * 0.62 }]} pointerEvents="none">
                <Text style={styles.careSpeechText}>{careSpeech}</Text>
              </View>
            )}
            {isPetting && (
              <>
                <PetHeartBurst
                  size={size}
                  heartCount={isBonusPetting ? 3 : affectionEffectHeartCountForLevel(affectionLevel)}
                  color={isBonusPetting ? '#f2b938' : affectionHeartColorForLevel(affectionLevel)}
                  durationMsOverride={isBonusPetting ? 2200 : undefined}
                  slowGrow={isBonusPetting}
                  peakScale={isBonusPetting ? 1.65 : undefined}
                />
                {isBonusPetting && (
                  <PetHeartBurst
                    size={size}
                    heartCount={2}
                    color="#fff3a0"
                    startDelay={140}
                    symbol="✦"
                    durationMsOverride={1850}
                    slowGrow
                    peakScale={1.35}
                  />
                )}
              </>
            )}
          </Animated.View>
        )}

        {state.condition !== 'dead' && particles.length > 0 && (
          <View style={styles.fallingParticleOverlay} pointerEvents="none">
            {particles.map((p) => (
              <FallingImageParticle key={p.id} p={p} fallDistance={screenHeight + 120} />
            ))}
          </View>
        )}

        {/* 数値・説明などの情報HUDは、オオサンより奥に置く。 */}
        <View style={styles.bottomInfoStack}>
          {state.condition === 'dead' ? (
            <View style={styles.deadState}>
              <View style={styles.deadMessagePanel}>
                <Text style={styles.deadTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  オオサンショウウオは旅立ちました
                </Text>
                <Text style={styles.deadBody}>長いあいだ世話ができなかったため、命を終えました。</Text>
                <Text style={styles.deadBody}>
                  新しいオオサンショウウオを迎え、もう一度育て始めることができます。
                </Text>
              </View>
              <TouchableOpacity
                onPress={restartWithNewOosan}
                accessibilityLabel="新しいオオサンショウウオを迎える"
                activeOpacity={0.7}
                style={styles.deadRestartAction}
              >
                <Text style={styles.deadRestartText}>新しいオオサンショウウオを迎える</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
            <View style={styles.dailyLogStrip}>
              <Animated.Text style={[styles.dailyLog, { opacity: dailyLogOpacity }]}> 
                {oosanMessageUsesName(state.latestLog)
                  ? namedOosanNarration(state.oosanName ?? DEFAULT_OOSAN_NAME, state.latestLog)
                  : state.latestLog}
              </Animated.Text>
            </View>
            <View style={[styles.hudGlassPanel, styles.gaugeBlock]}>
              <View style={styles.gaugeRow}>
                <View style={styles.gaugeLabelRow}>
                  <Text style={styles.gaugeLabelShrink}>おなか</Text>
                  <TouchableOpacity
                    onPress={() => setCareTimingInfoOpen(true)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="おなかとヌメリの減少時間を確認する"
                  >
                    <Ionicons name="information-circle-outline" size={15} color="#ffffff" style={styles.gaugeInfoIcon} />
                  </TouchableOpacity>
                  {state.fullness < 38 && (
                    <TouchableOpacity
                      onPress={() => showCareGaugeWarning('feed', state.fullness <= 0)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.gaugeWarningButton}
                      accessibilityLabel="おなかの状態を確認する"
                    >
                      <Ionicons
                        name="warning"
                        size={16}
                        color="#ffcc80"
                        style={styles.viscosityWarnIcon}
                      />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.gaugeTrack}>
                  <View style={styles.gaugeBarBackground}>
                    <View
                      style={[
                        styles.gaugeFill,
                        {
                          width: `${Math.round(state.fullness)}%`,
                          backgroundColor: fullnessBarColor(state.fullness),
                        },
                      ]}
                    />
                    <View pointerEvents="none" style={[styles.gaugeDivider, styles.gaugeDividerFirst]} />
                    <View pointerEvents="none" style={[styles.gaugeDivider, styles.gaugeDividerSecond]} />
                  </View>
                  <View style={styles.gaugeRewardScale} pointerEvents="none">
                    <Text style={styles.gaugeRewardLabel}>+1pt</Text>
                    <Text style={styles.gaugeRewardLabel}>+1pt</Text>
                    <Text style={styles.gaugeRewardLabel}>+1pt</Text>
                  </View>
                </View>
                <Text style={styles.gaugePct}>{Math.round(state.fullness)}%</Text>
              </View>
              <View style={[styles.gaugeRow, styles.gaugeRowLast]}>
                <View style={styles.gaugeLabelRow}>
                  <Text style={styles.gaugeLabelShrink}>ヌメリ</Text>
                  <TouchableOpacity
                    onPress={() => setCareTimingInfoOpen(true)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="おなかとヌメリの減少時間を確認する"
                  >
                    <Ionicons name="information-circle-outline" size={15} color="#ffffff" style={styles.gaugeInfoIcon} />
                  </TouchableOpacity>
                  {state.viscosity < 38 && (
                    <TouchableOpacity
                      onPress={() => showCareGaugeWarning('water', state.viscosity <= 0)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.gaugeWarningButton}
                      accessibilityLabel="ヌメリの状態を確認する"
                    >
                      <Ionicons
                        name="warning"
                        size={16}
                        color="#ffcc80"
                        style={styles.viscosityWarnIcon}
                      />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.gaugeTrack}>
                  <View style={styles.gaugeBarBackground}>
                    <View
                      style={[
                        styles.gaugeFill,
                        styles.gaugeFillViscosity,
                        {
                          width: `${Math.round(state.viscosity)}%`,
                          backgroundColor: viscosityBarColor(state.viscosity),
                        },
                      ]}
                    />
                    <View pointerEvents="none" style={[styles.gaugeDivider, styles.gaugeDividerFirst]} />
                    <View pointerEvents="none" style={[styles.gaugeDivider, styles.gaugeDividerSecond]} />
                  </View>
                  <View style={styles.gaugeRewardScale} pointerEvents="none">
                    <Text style={styles.gaugeRewardLabel}>+1pt</Text>
                    <Text style={styles.gaugeRewardLabel}>+1pt</Text>
                    <Text style={styles.gaugeRewardLabel}>+1pt</Text>
                  </View>
                </View>
                <Text style={styles.gaugePct}>{Math.round(state.viscosity)}%</Text>
              </View>
            </View>
            <View style={[styles.hudGlassPanel, styles.affectionBlock]}>
              <View style={styles.affectionHeader}>
                <Text style={styles.affectionLabel}>なつき</Text>
                <Text style={styles.affectionLevelText}>Lv.{displayedAffectionLevel} / 100</Text>
                <Pressable
                  style={styles.guideInfoButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    setGrowthGuideOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="なつき度ガイドを開く"
                >
                  <Ionicons name="information-circle-outline" size={20} color="#f9dfe5" />
                </Pressable>
              </View>
              <AffectionLevelHearts level={displayedAffectionLevel} />
              <View style={styles.affectionProgressRow}>
                <View style={styles.affectionProgressTrack}>
                  <View
                    style={[
                      styles.affectionProgressFill,
                      { backgroundColor: affectionColor, width: `${Math.round(affectionLevelProgress * 100)}%` },
                    ]}
                  />
                  {affectionGaugeCelebration && <AffectionGaugeFullEffect color={affectionColor} />}
                </View>
                <Text style={styles.affectionProgressText}>{affectionProgressText}</Text>
              </View>
              <Text style={styles.affectionHint}>なでると仲良くなれます（1日{normalPetLimit}回まで）</Text>
            </View>
            </>
          )}
        </View>
        {/* お世話ボタンは常にオオサンより手前。 */}
        {state.condition !== 'dead' && (
          <View style={styles.bottomActionStack}>
            <View style={styles.actionRow}>
              <View style={[styles.actionItem, styles.actionItemFeed]}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnFeed, (bonusFeedCare > 0 || initialFeedCareGuide) && styles.actionBtnBonus, bonusFeedCare <= 0 && !canEarnFeedPoint && styles.actionBtnFeedNoPoint]}
                  onPress={onFeed}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.actionBtnText, bonusFeedCare > 0 && styles.actionBtnTextBonus, bonusFeedCare <= 0 && !canEarnFeedPoint && styles.actionBtnTextNoPoint]}>{bonusFeedCare > 0 ? 'ごほうびごはん' : 'ごはん'}</Text>
                </TouchableOpacity>
                <View style={styles.actionPointSlot} pointerEvents="none">
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.actionPointHint, bonusFeedCare > 0 && styles.actionPointHintBonus, bonusFeedCare <= 0 && !canEarnFeedPoint && styles.actionPointHintNoPoint]}>
                    {bonusFeedCare > 0 ? `ごほうび あと${bonusFeedCare}回` : feedDailyPointCapReached ? `今日${dailyCarePointCap}ptまで` : canEarnFeedPoint ? '+1pt' : feedPointWait}
                  </Text>
                </View>
              </View>
              <View style={[styles.actionItem, styles.actionItemWater]}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnWater, (bonusWaterCare > 0 || initialWaterCareGuide) && styles.actionBtnBonus, bonusWaterCare <= 0 && !canEarnWaterPoint && styles.actionBtnWaterNoPoint]}
                  onPress={onWater}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.actionBtnText, bonusWaterCare > 0 && styles.actionBtnTextBonus, bonusWaterCare <= 0 && !canEarnWaterPoint && styles.actionBtnTextNoPoint]}>{bonusWaterCare > 0 ? 'ごほうびおみず' : 'おみず'}</Text>
                </TouchableOpacity>
                <View style={styles.actionPointSlot} pointerEvents="none">
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.actionPointHint, bonusWaterCare > 0 && styles.actionPointHintBonus, bonusWaterCare <= 0 && !canEarnWaterPoint && styles.actionPointHintNoPoint]}>
                    {bonusWaterCare > 0 ? `ごほうび あと${bonusWaterCare}回` : waterDailyPointCapReached ? `今日${dailyCarePointCap}ptまで` : canEarnWaterPoint ? '+1pt' : waterPointWait}
                  </Text>
                </View>
              </View>
              <View style={[styles.actionItem, styles.actionItemPet]}>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPet, petBonusAvailable && styles.actionBtnBonus, !canPetToday && styles.actionBtnPetResting]} onPress={() => onPet(true)} activeOpacity={0.85}>
                  {petBonusAvailable && <Ionicons pointerEvents="none" name="sparkles" size={12} color="#fff4b5" style={styles.bonusPetSparkleLeft} />}
                  <Text style={[styles.actionBtnText, petBonusAvailable && styles.actionBtnTextBonus]}>{petBonusAvailable ? 'ごほうびなでなで' : 'なでる'}</Text>
                  {petBonusAvailable && <Ionicons pointerEvents="none" name="sparkles" size={12} color="#fff4b5" style={styles.bonusPetSparkleRight} />}
                </TouchableOpacity>
                <View style={styles.actionPointSlot} pointerEvents="none">
                  <Text style={[styles.actionPointHint, petBonusAvailable && styles.actionPointHintBonus]}>
                    {petBonusAvailable ? `ごほうび あと${petBonusUsesRemaining}回` : petNormalCount < normalPetLimit ? `あと ${normalPetLimit - petNormalCount}回` : '今日はおしまい'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
        {state.condition !== 'dead' && (
          <TouchableOpacity
            style={styles.missionFloatingButton}
            onPress={() => setMissionOpen(true)}
            activeOpacity={0.85}
            accessibilityLabel="きょうのミッションを開く"
            hitSlop={{ top: 22, bottom: 22, left: 22, right: 22 }}
          >
            <View style={styles.missionLogIconCircle}>
              <Ionicons name="checkbox-outline" size={30} color="rgba(255,255,255,0.97)" />
              {missionRewardAvailable && <View style={styles.missionFabDot} />}
            </View>
            <Text style={styles.missionLogLabel}>ミッション</Text>
          </TouchableOpacity>
        )}
      </Pressable>
    </ScrollView>

      <TouchableOpacity
        style={styles.legalFab}
        onPress={() => setLegalInfoOpen(true)}
        activeOpacity={0.85}
        accessibilityLabel="利用規約・プライバシー・お問い合わせ"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="document-text-outline" size={22} color="rgba(255,255,255,0.95)" />
      </TouchableOpacity>

      <LegalInfoModal visible={legalInfoOpen} onClose={() => setLegalInfoOpen(false)} />
      <GrowthGuideModal
        visible={growthGuideOpen}
        onClose={() => setGrowthGuideOpen(false)}
        affection={state?.affection ?? 0}
        bodyLengthCm={state?.bodyLengthCm ?? 0.5}
        oosanName={state?.oosanName ?? DEFAULT_OOSAN_NAME}
      />

      <Modal
        visible={restartConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRestartConfirmOpen(false)}
      >
        <View style={styles.missionRewardBackdrop}>
          <View style={styles.missionRewardPopupCard}>
            <View style={styles.careWarningPopupIcon}>
              <Ionicons name="refresh" size={34} color="#3baee0" />
            </View>
            <Text style={styles.missionRewardPopupEyebrow}>NEW JOURNEY</Text>
            <Text style={styles.missionRewardPopupTitle}>新しく迎えますか？</Text>
            <Text style={styles.missionRewardPopupBody}>これまでの体長・おなか・ぬめり・成長の状態は初期化されます。</Text>
            <View style={styles.restartConfirmActions}>
              <Pressable style={styles.restartConfirmCancel} onPress={() => setRestartConfirmOpen(false)}>
                <Text style={styles.restartConfirmCancelText}>今は閉じる</Text>
              </Pressable>
              <Pressable style={styles.restartConfirmStart} onPress={confirmRestartWithNewOosan}>
                <Text style={styles.missionRewardPopupButtonText}>迎える</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={newOosanGuideOpen}
        transparent
        animationType="fade"
        onRequestClose={beginLifeWithOosan}
      >
        <KeyboardAvoidingView style={styles.nameModalKeyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.missionRewardBackdrop, styles.nameModalBackdrop]}>
          <View style={[styles.missionRewardPopupCard, styles.newOosanGuideCard, styles.nameEntryPopupCard]}>
            <Pressable style={styles.nameModalCloseButton} onPress={beginLifeWithOosan} accessibilityRole="button" accessibilityLabel="名前を確定して閉じる">
              <Ionicons name="close" size={21} color="#52766d" />
            </Pressable>
            <Text style={styles.missionRewardPopupEyebrow}>WELCOME TO THE RIVER</Text>
            <Text style={styles.missionRewardPopupTitle}>オオサンショウウオがやってきた！</Text>
            <ExpoImage
              source={require('./assets/images/sansyo_toka2.gif')}
              style={styles.newOosanGuideImage}
              contentFit="contain"
            />
            <Text style={styles.missionRewardPopupBody}>この子のなまえを決めよう</Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={15}
              selectTextOnFocus
              returnKeyType="done"
              // キーボードの「完了」で、入力中の名前を確定して案内を閉じる。
              onSubmitEditing={beginLifeWithOosan}
              placeholder={DEFAULT_OOSAN_NAME}
              placeholderTextColor="#9bb5af"
              style={styles.nameInput}
              accessibilityLabel="オオサンショウウオの名前"
            />
            <Text style={styles.missionRewardPopupBody}>
              まずは「ごはん」と「おみず」をあげて、{`\n`}元気にしてあげよう。
            </Text>
            <Pressable style={styles.missionRewardPopupButton} onPress={beginLifeWithOosan}>
              <Text style={styles.missionRewardPopupButtonText}>お世話をはじめる</Text>
            </Pressable>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={nameEditorOpen}
        transparent
        animationType="fade"
        onRequestClose={saveOosanName}
      >
        <KeyboardAvoidingView style={styles.nameModalKeyboardAvoider} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.missionRewardBackdrop, styles.nameModalBackdrop]}>
          <View style={[styles.missionRewardPopupCard, styles.nameEntryPopupCard]}>
            <Pressable style={styles.nameModalCloseButton} onPress={saveOosanName} accessibilityRole="button" accessibilityLabel="名前を確定して閉じる">
              <Ionicons name="close" size={21} color="#52766d" />
            </Pressable>
            <View style={styles.missionRewardPopupIcon}>
              <Ionicons name="create" size={32} color="#3baee0" />
            </View>
            <Text style={styles.missionRewardPopupEyebrow}>NAME YOUR FRIEND</Text>
            <Text style={styles.missionRewardPopupTitle}>なまえをつけよう</Text>
            <Text style={styles.missionRewardPopupBody}>15文字まで。いつでもここから変えられます。</Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={15}
              selectTextOnFocus
              returnKeyType="done"
              // キーボードの「完了」でも、入力中の名前を確定して閉じられる。
              onSubmitEditing={saveOosanName}
              placeholder={DEFAULT_OOSAN_NAME}
              placeholderTextColor="#9bb5af"
              style={styles.nameInput}
              accessibilityLabel="オオサンショウウオの名前"
            />
            <View style={styles.restartConfirmActions}>
              <Pressable style={styles.restartConfirmCancel} onPress={() => setNameEditorOpen(false)}>
                <Text style={styles.restartConfirmCancelText}>やめる</Text>
              </Pressable>
              <Pressable style={styles.restartConfirmStart} onPress={saveOosanName}>
                <Text style={styles.missionRewardPopupButtonText}>決定</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={careWarningOpen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCareWarningOpen(null)}
      >
        {careWarningOpen && (() => {
          const isFeed = careWarningOpen.kind === 'feed';
          const resource = isFeed ? 'おなか' : 'ヌメリ';
          const action = isFeed ? 'ごはん' : 'おみず';
          return (
            <View style={styles.missionRewardBackdrop}>
              <View style={[styles.missionRewardPopupCard, styles.careWarningPopupCard]}>
                <View style={styles.careWarningPopupIcon}>
                  <Ionicons name="warning" size={34} color="#c9841d" />
                </View>
                <Text style={styles.careWarningEyebrow}>CARE CHECK</Text>
                <Text style={styles.careWarningTitle}>
                  {careWarningOpen.isEmpty ? `${resource}が空っぽ！` : `${resource}が少なくなっています`}
                </Text>
                <Text style={styles.careWarningBody}>
                  {careWarningOpen.isEmpty
                    ? `はやく「${action}」をあげてね。\n\n空っぽのまま放置せず、毎日様子を見にきてください。30日間会えないと、オオサンショウウオは旅立ってしまいます。`
                    : `もうすぐ${resource}が空っぽになります。\n「${action}」で元気にしてあげてね。`}
                </Text>
                <Pressable style={styles.careWarningPopupButton} onPress={() => setCareWarningOpen(null)}>
                  <Text style={styles.missionRewardPopupButtonText}>お世話する</Text>
                </Pressable>
              </View>
            </View>
          );
        })()}
      </Modal>

      <Modal
        visible={careTimingInfoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCareTimingInfoOpen(false)}
      >
        <View style={styles.missionRewardBackdrop}>
          <View style={[styles.missionRewardPopupCard, styles.careWarningPopupCard]}>
            <View style={styles.careWarningPopupIcon}>
              <Ionicons name="time-outline" size={34} color="#3baee0" />
            </View>
            <Text style={styles.missionRewardPopupEyebrow}>CARE TIMING</Text>
            <Text style={styles.missionRewardPopupTitle}>お世話の目安</Text>
            <View style={styles.careTimingCopy}>
              <Text style={styles.careTimingBody}>おなかとヌメリは、</Text>
              <Text style={styles.careTimingBody}>満タンから約12時間で空になります。</Text>
              <Text style={[styles.careTimingBody, styles.careTimingBodySecond]}>ときどき様子を見て、</Text>
              <Text style={styles.careTimingBody}>ごはんとおみずをあげよう。</Text>
            </View>
            <Pressable style={styles.careWarningPopupButton} onPress={() => setCareTimingInfoOpen(false)}>
              <Text style={styles.missionRewardPopupButtonText}>わかった</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={missionOpen} transparent animationType="fade" onRequestClose={() => setMissionOpen(false)}>
        <View style={styles.missionBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMissionOpen(false)} accessibilityLabel="ミッションを閉じる" />
          <View style={styles.missionModalCard}>
            <View style={styles.missionModalHeader}>
              <View>
                <Text style={styles.missionModalEyebrow}>DAILY MISSIONS</Text>
                <Text style={styles.missionModalTitle}>きょうのミッション</Text>
              </View>
              <Pressable style={styles.missionCloseIcon} onPress={() => setMissionOpen(false)} accessibilityLabel="閉じる">
                <Ionicons name="close" size={22} color="#2d6d79" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.missionModalContent}>
              {displayedGrowthMission && (
                <View style={styles.missionGroupCard}>
                  <View style={styles.missionGroupHeader}>
                    <Ionicons name="leaf-outline" size={20} color="#3baee0" />
                    <View style={styles.missionGroupHeading}>
                      <Text style={styles.missionGroupTitle}>成長ミッション</Text>
                      <Text style={styles.missionGroupSubtitle}>
                        {availableGrowthMission ? '成長の道のりを達成しました！' : `次の目標：${displayedGrowthMission.cm}cm ${displayedGrowthMission.name}`}
                      </Text>
                    </View>
                    <Text style={[styles.missionGroupStatus, availableGrowthMission && styles.missionGroupStatusReward]}>
                      {availableGrowthMission ? '報酬あり' : '挑戦中'}
                    </Text>
                  </View>
                  <View style={styles.missionTaskRow}>
                    <Ionicons name={availableGrowthMission ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={availableGrowthMission ? '#54b889' : '#9bc5bb'} />
                    <Text style={[styles.missionTaskLabel, availableGrowthMission && styles.missionTaskLabelDone]}>
                      {displayedGrowthMission.cm}cm　{displayedGrowthMission.name}
                    </Text>
                  </View>
                  <View style={styles.missionRewardRow}>
                    <Ionicons name={growthRewardIcon(growthMissionRewardKindForCm(displayedGrowthMission.cm))} size={17} color={growthMissionRewardKindForCm(displayedGrowthMission.cm) === 'water' ? '#3baee0' : '#d29b2e'} />
                    <Text style={styles.missionRewardText} numberOfLines={2}>
                      {`体長 +${growthMissionDirectPointsForCm(displayedGrowthMission.cm)}pt\n${growthRewardLabel(growthMissionRewardKindForCm(displayedGrowthMission.cm), growthMissionRewardForCm(displayedGrowthMission.cm))}`}
                    </Text>
                    {availableGrowthMission && (
                      <Pressable style={styles.missionClaimButton} onPress={() => claimGrowthMission(availableGrowthMission.cm)} accessibilityLabel="成長ミッションの報酬を受け取る">
                        <Text style={styles.missionClaimButtonText}>受け取る</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
              <View style={styles.missionGroupCard}>
                <View style={styles.missionGroupHeader}>
                  <Ionicons name="restaurant-outline" size={20} color="#2f9b85" />
                  <View style={styles.missionGroupHeading}>
                    <Text style={styles.missionGroupTitle}>お世話ミッション</Text>
                    <Text style={styles.missionGroupSubtitle}>ごはんとおみずを満タンにしよう</Text>
                  </View>
                  <Text style={[styles.missionGroupStatus, dailyCareBonusAwarded && styles.missionGroupStatusDone]}>
                    {dailyCareBonusAwarded ? '受取済み' : dailyCareRewardAvailable ? '報酬あり' : '進行中'}
                  </Text>
                </View>
                <View style={styles.missionTaskRow}>
                  <Ionicons name={dailyFeedMissionComplete ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={dailyFeedMissionComplete ? '#54b889' : '#9bc5bb'} />
                  <Text style={[styles.missionTaskLabel, dailyFeedMissionComplete && styles.missionTaskLabelDone]}>ごはんを満タンにする</Text>
                </View>
                <View style={styles.missionTaskRow}>
                  <Ionicons name={dailyWaterMissionComplete ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={dailyWaterMissionComplete ? '#54b889' : '#9bc5bb'} />
                  <Text style={[styles.missionTaskLabel, dailyWaterMissionComplete && styles.missionTaskLabelDone]}>おみずを満タンにする</Text>
                </View>
                <View style={styles.missionRewardRow}>
                  <Ionicons name="sparkles" size={17} color="#d29b2e" />
                  <Text style={styles.missionRewardText}>報酬：体長 +1pt</Text>
                  {dailyCareRewardAvailable && (
                    <Pressable style={styles.missionClaimButton} onPress={claimDailyMissionReward} accessibilityLabel="お世話ミッションの報酬を受け取る">
                      <Text style={styles.missionClaimButtonText}>受け取る</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <View style={styles.missionGroupCard}>
                <View style={styles.missionGroupHeader}>
                  <Ionicons name="heart-outline" size={20} color="#e77d97" />
                  <View style={styles.missionGroupHeading}>
                    <Text style={styles.missionGroupTitle}>なかよしミッション</Text>
                    <Text style={styles.missionGroupSubtitle}>満タンでごほうびなでなでをもらおう</Text>
                  </View>
                  <Text style={[styles.missionGroupStatus, dailyPetBonusClaimed && styles.missionGroupStatusDone]}>
                    {dailyPetBonusUsed ? '受取済み' : dailyPetBonusClaimed ? '受取済み' : dailyPetMissionComplete ? '報酬あり' : '進行中'}
                  </Text>
                </View>
                <View style={styles.missionTaskRow}>
                  <Ionicons name={dailyPetMissionComplete ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={dailyPetMissionComplete ? '#e77d97' : '#dcb3c0'} />
                  <Text style={[styles.missionTaskLabel, dailyPetMissionComplete && styles.missionTaskLabelDone]}>きょうのなでなでを満タンにしよう</Text>
                </View>
                <View style={styles.missionRewardRow}>
                  <Ionicons name={dailyPetBonusClaimed ? 'checkmark-circle' : 'heart'} size={17} color={dailyPetBonusClaimed ? '#54b889' : '#e77d97'} />
                  <Text style={styles.missionRewardText}>
                    {dailyPetBonusUsed ? '報酬：ごほうびなでなで 受取済み' : dailyPetBonusClaimed ? `報酬：ごほうびなでなで 残り${petBonusUsesRemaining}回` : dailyPetMissionComplete ? '報酬：ごほうびなでなで 3回！' : '報酬：ごほうびなでなで +3回'}
                  </Text>
                  {petRewardAvailable && (
                    <Pressable style={styles.missionClaimButton} onPress={claimDailyPetMission} accessibilityLabel="なかよしミッションの報酬を受け取る">
                      <Text style={styles.missionClaimButtonText}>受け取る</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <Text style={styles.missionModalNote}>これから増えるミッションも、種類ごとにここへ追加されます。</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={dailyMissionRewardPopup !== null} transparent animationType="fade" onRequestClose={() => setDailyMissionRewardPopup(null)}>
        {dailyMissionRewardPopup && (
          <View style={styles.missionRewardBackdrop}>
            <View style={styles.missionRewardPopupCard}>
              <View style={styles.missionRewardPopupIcon}>
                <Ionicons name={dailyMissionRewardPopup.kind === 'pet' ? 'heart' : dailyMissionRewardPopup.kind === 'growth' ? growthRewardIcon(dailyMissionRewardPopup.reward ?? 'none') : 'sparkles'} size={34} color={dailyMissionRewardPopup.kind === 'pet' ? '#e77d97' : dailyMissionRewardPopup.kind === 'growth' && dailyMissionRewardPopup.reward === 'water' ? '#3baee0' : '#d49c26'} />
              </View>
              <Text style={styles.missionRewardPopupEyebrow}>MISSION COMPLETE!</Text>
              <Text style={styles.missionRewardPopupTitle}>{dailyMissionRewardPopup.kind === 'pet' ? 'なかよしミッション達成！' : dailyMissionRewardPopup.kind === 'growth' ? '成長ミッション達成！' : 'お世話ミッション達成！'}</Text>
              <Text style={styles.missionRewardPopupBody}>{dailyMissionRewardPopup.kind === 'pet' ? 'ごほうびなでなでを受け取りました' : dailyMissionRewardPopup.kind === 'growth' ? 'ごほうびのお世話を受け取りました' : '体長ポイントを受け取りました'}</Text>
              <Text style={styles.missionRewardPopupPoint}>
                {dailyMissionRewardPopup.kind === 'pet'
                  ? 'ごほうびなでなで +3回'
                  : dailyMissionRewardPopup.kind === 'growth'
                    ? `体長 +${dailyMissionRewardPopup.directPoints ?? 0}pt\n${growthRewardLabel(dailyMissionRewardPopup.reward ?? 'none', dailyMissionRewardPopup.amount ?? 3)}`
                    : '体長 +1pt'}
              </Text>
              <Pressable style={styles.missionRewardPopupButton} onPress={() => setDailyMissionRewardPopup(null)}>
                <Text style={styles.missionRewardPopupButtonText}>やった！</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>

      <Modal
        visible={growthStageNotice != null}
        transparent
        animationType="fade"
        onRequestClose={() => setGrowthStageNotice(null)}
      >
        {growthStageNotice && <View style={styles.growthStageUpBackdrop}>
          <View style={styles.growthStageUpCard}>
            <Text style={styles.growthStageUpEyebrow}>体長 {growthStageNotice.cm}cm 到達！</Text>
            <Text style={styles.growthStageUpTitle}>成長したよ！</Text>
            <ExpoImage
              source={
                growthStageNotice.cm >= ADULT_OOSAN_MIN_LENGTH_CM
                  ? ADULT_WALK_FRAMES[0]
                  : require('./assets/images/sansyo_toka2.gif')
              }
              style={styles.growthStageUpImage}
              contentFit="contain"
            />
            <Text style={styles.growthStageUpName}>{growthStageNotice.name}</Text>
            <Text style={styles.growthStageUpBody}>ひとまわり大きくなりました。</Text>
            <Pressable style={styles.growthStageUpButton} onPress={() => setGrowthStageNotice(null)}>
              <Text style={styles.growthStageUpButtonText}>これからも育てる</Text>
            </Pressable>
          </View>
        </View>}
      </Modal>

      <Modal
        visible={growthLengthUp != null}
        transparent
        animationType="fade"
        onRequestClose={() => setGrowthLengthUp(null)}
      >
        {growthLengthUp && <View style={styles.growthStageUpBackdrop}>
          <View style={styles.growthLevelUpCard}>
            <Text style={styles.growthStageUpEyebrow}>育成レベルアップ！</Text>
            <Text style={styles.growthStageUpTitle}>体長 {growthLengthUp.cm}cm になった！</Text>
            <ExpoImage
              source={
                growthLengthUp.bodyLengthCm >= ADULT_OOSAN_MIN_LENGTH_CM
                  ? ADULT_WALK_FRAMES[0]
                  : require('./assets/images/sansyo_toka2.gif')
              }
              style={styles.growthLevelUpImage}
              contentFit="contain"
            />
            <Text style={styles.growthStageUpBody}>オオサンショウウオが、少し大きくなりました。</Text>
            <Pressable style={styles.growthStageUpButton} onPress={() => setGrowthLengthUp(null)}>
              <Text style={styles.growthStageUpButtonText}>これからも育てる</Text>
            </Pressable>
          </View>
        </View>}
      </Modal>

      <Modal
        visible={adultEvolutionOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAdultEvolutionOpen(false)}
      >
        <View style={styles.adultEvolutionBackdrop}>
          <View style={styles.adultEvolutionCard}>
            <Text style={styles.adultEvolutionEyebrow}>体長 20cm 達成！</Text>
            <Text style={styles.adultEvolutionTitle}>おとなの姿になった！</Text>
            <ExpoImage
              source={ADULT_WALK_FRAMES[0]}
              style={styles.adultEvolutionImage}
              contentFit="contain"
            />
            <Text style={styles.adultEvolutionBody}>
              これからは、りっぱなオオサンショウウオとして{`\n`}ゆっくり大きくなっていきます。
            </Text>
            <Pressable style={styles.adultEvolutionButton} onPress={() => setAdultEvolutionOpen(false)}>
              <Text style={styles.adultEvolutionButtonText}>これからも育てる</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={affectionLevelUp != null}
        transparent
        animationType="fade"
        onRequestClose={() => setAffectionLevelUp(null)}
      >
        {affectionLevelUp && <View style={styles.affectionLevelUpBackdrop}>
          <View style={styles.affectionLevelUpCard}>
            <Text style={styles.affectionLevelUpEyebrow}>なつき度アップ！</Text>
            <Text style={styles.affectionLevelUpHearts}>♥</Text>
            <Text style={styles.affectionLevelUpTitle}>なつきLv.{affectionLevelUp.level} になった！</Text>
            <Text style={styles.affectionLevelUpName}>{affectionLevelUp.name}</Text>
            <Text style={styles.affectionLevelUpBody}>なでてもらえて、もっと仲良くなれたよ。</Text>
            <Pressable style={styles.affectionLevelUpButton} onPress={() => setAffectionLevelUp(null)}>
              <Text style={styles.affectionLevelUpButtonText}>これからもなでる</Text>
            </Pressable>
          </View>
        </View>}
      </Modal>

      {sparkleActive && celebrationItem?.tier === 'low' && (
        <SparkleOverlay
          key={celebrationItem.id}
          onDone={() => {
            const m = celebrationItem;
            setSparkleActive(false);
            if (m) commitClaimMilestone(m);
            setCelebrationItem(null);
          }}
        />
      )}

      {bannerMsg != null && (
        <Animated.View
          pointerEvents="none"
          style={[styles.milestoneBannerWrap, { opacity: bannerAnim }]}
        >
          <Text style={styles.milestoneBannerText}>{bannerMsg}</Text>
        </Animated.View>
      )}

      <Modal visible={offlineBacklogPageQueue.length > 0} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>離れている間に成長したよ</Text>
            {(() => {
              const meta = offlineBacklogModalMetaRef.current;
              const page = offlineBacklogPageQueue[0];
              if (!page || !meta) return null;
              const pageIdx = meta.pageCount - offlineBacklogPageQueue.length + 1;
              const isSplit = meta.pageCount > 1;
              const summary = isSplit
                ? `${meta.total}件達成のうち ${pageIdx}/${meta.pageCount} 画面目です。`
                : `${meta.total}つのマイルストーンを達成しました！`;
              return (
                <>
                  <Text style={styles.modalBody}>{summary}</Text>
                  {page.map((m) => (
                    <Text key={m.id} style={styles.modalListItem}>
                      ・{m.name}
                    </Text>
                  ))}
                </>
              );
            })()}
            <Pressable
              style={styles.modalButton}
              onPress={() => {
                const page = offlineBacklogPageQueue[0];
                if (!page) return;
                commitClaimMany(page);
                setOfflineBacklogPageQueue((q) => {
                  const rest = q.slice(1);
                  if (rest.length === 0) {
                    offlineBacklogModalMetaRef.current = null;
                  }
                  return rest;
                });
              }}
            >
              <Text style={styles.modalButtonLabel}>
                {offlineBacklogPageQueue.length > 1 ? '次へ' : 'わかった'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={
          celebrationItem != null &&
          (celebrationItem.tier === 'medium' || celebrationItem.tier === 'high')
        }
        transparent
        animationType="fade"
      >
        {celebrationItem && <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>達成！</Text>
            <Text style={styles.modalCelebrateName}>{celebrationItem.name}</Text>
            <Text style={styles.modalBody}>
              {celebrationItem.tier === 'high'
                ? '大きな一歩だね。これからも一緒に川を泳ごう。'
                : '順調に育っているよ。'}
            </Text>
            <Pressable
              style={styles.modalButton}
              onPress={() => {
                if (celebrationItem) commitClaimMilestone(celebrationItem);
                setCelebrationItem(null);
              }}
            >
              <Text style={styles.modalButtonLabel}>よし！</Text>
            </Pressable>
          </View>
        </View>}
      </Modal>

      <DebugOverlay
        onApplyBodyLengthCm={applyDebugBodyLengthCm}
        onApplyAffection={applyDebugAffection}
        onResetPetCount={resetDebugPetCount}
        onResetDailyMissions={resetDebugDailyMissions}
        onApplyGauges={applyDebugGauges}
        onSetDead={applyDebugDeadState}
        onSendCareAlert={() => void notifyCareEmptyNow()}
        onSendInactivityReminder={() => void notifyInactivityReminderNow()}
        onSendThirtyDayReminder={() => void notifyThirtyDayReminderNow()}
      />
    </View>
  );
};

const App: React.FC = () => (
  <DebugTimeProvider>
    <AppMain />
  </DebugTimeProvider>
);

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
  },
  /** 右上: インフォメーション。DebugOverlay の FAB は right: 62 で隣接 */
  legalFab: {
    position: 'absolute',
    right: 10,
    top: Platform.OS === 'ios' ? 56 : 52,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 360,
    elevation: 18,
  },
  /** ミッションは情報HUDから分離し、オオサンより上の独立レイヤーへ置く。 */
  missionFloatingButton: {
    position: 'absolute',
    right: 16,
    // セリフ帯とは離しつつ、上へ行きすぎない中間の高さに置く。
    bottom: Platform.select({ ios: 406, android: 374, default: 366 }),
    width: 76,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 530,
    elevation: 60,
  },
  missionLogIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(33, 150, 243, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionFabDot: {
    position: 'absolute',
    top: 3,
    right: 2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ffcc80',
    borderWidth: 1,
    borderColor: '#fff1c9',
  },
  missionLogLabel: { marginTop: 2, color: 'rgba(255,255,255,0.96)', fontSize: 9, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  missionBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(4, 31, 42, 0.62)' },
  missionModalCard: { width: '100%', maxWidth: 390, maxHeight: '78%', borderRadius: 22, overflow: 'hidden', backgroundColor: '#f5fffb', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 20 },
  missionModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 19, paddingTop: 18, paddingBottom: 14, backgroundColor: '#d9f4e9' },
  missionModalEyebrow: { color: '#3d9a83', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  missionModalTitle: { marginTop: 2, color: '#1e655d', fontSize: 22, fontWeight: '900' },
  missionCloseIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.76)' },
  missionModalContent: { padding: 15, paddingBottom: 20 },
  missionGroupCard: { padding: 14, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d9eee7', marginBottom: 12 },
  missionGroupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  missionGroupHeading: { flex: 1, marginLeft: 8 },
  missionGroupTitle: { color: '#245f59', fontSize: 16, fontWeight: '900' },
  missionGroupSubtitle: { marginTop: 1, color: '#6f9189', fontSize: 11, fontWeight: '600' },
  missionGroupStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, overflow: 'hidden', color: '#5f8f84', backgroundColor: '#e8f6f1', fontSize: 10, fontWeight: '900' },
  missionGroupStatusDone: { color: '#23795d', backgroundColor: '#d6f4e5' },
  missionGroupStatusReward: { color: '#a26919', backgroundColor: '#fff0c9' },
  missionTaskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  missionTaskLabel: { marginLeft: 8, color: '#50746d', fontSize: 14, fontWeight: '700' },
  missionTaskLabelDone: { color: '#359572', textDecorationLine: 'line-through' },
  missionRewardRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#dceee8' },
  missionRewardText: { flex: 1, flexShrink: 1, marginLeft: 6, color: '#98762c', fontSize: 12, lineHeight: 17, fontWeight: '900' },
  missionClaimButton: { marginLeft: 'auto', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 11, backgroundColor: '#32a887' },
  missionClaimButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  missionModalNote: { color: '#75958d', fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8, marginTop: 2 },
  missionRewardBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22, backgroundColor: 'rgba(6, 38, 47, 0.68)' },
  missionRewardPopupCard: { width: '100%', maxWidth: 350, alignItems: 'center', borderRadius: 24, paddingHorizontal: 22, paddingTop: 25, paddingBottom: 20, backgroundColor: '#f6fffb', borderWidth: 2, borderColor: '#a9e3cb', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 22 },
  missionRewardPopupIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff2c5' },
  missionRewardPopupEyebrow: { marginTop: 14, color: '#43a887', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  missionRewardPopupTitle: { marginTop: 5, color: '#276b60', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  missionRewardPopupBody: { marginTop: 11, color: '#5e8179', fontSize: 13, textAlign: 'center' },
  missionRewardPopupPoint: { marginTop: 5, color: '#c5891c', fontSize: 20, lineHeight: 27, fontWeight: '900', textAlign: 'center' },
  missionRewardPopupButton: { alignSelf: 'stretch', marginTop: 18, borderRadius: 14, paddingVertical: 13, backgroundColor: '#32a887' },
  missionRewardPopupButtonText: { color: '#fff', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  restartConfirmActions: { alignSelf: 'stretch', flexDirection: 'row', gap: 9, marginTop: 18 },
  restartConfirmCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 13, backgroundColor: '#e6f0ed' },
  restartConfirmCancelText: { color: '#52766d', fontSize: 15, fontWeight: '900' },
  restartConfirmStart: { flex: 1.2, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 13, backgroundColor: '#32a887' },
  newOosanGuideCard: { borderColor: '#93d6ee' },
  nameModalKeyboardAvoider: { flex: 1 },
  nameModalBackdrop: { justifyContent: 'flex-start', paddingTop: Platform.OS === 'ios' ? 58 : 42, paddingBottom: 16 },
  nameEntryPopupCard: { paddingTop: 43 },
  nameModalCloseButton: { position: 'absolute', top: 10, left: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e6f0ed', zIndex: 2 },
  newOosanGuideImage: { width: '100%', height: 118, marginTop: 0, marginBottom: 0 },
  nameInput: { alignSelf: 'stretch', marginTop: 16, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: '#276b60', fontSize: 18, fontWeight: '800', textAlign: 'center', backgroundColor: '#eef9f5', borderWidth: 1.5, borderColor: '#8bd4bb' },
  careWarningPopupCard: { borderColor: '#f0cf8e' },
  careWarningPopupIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff2c5' },
  careWarningEyebrow: { marginTop: 14, color: '#b97a22', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  careWarningTitle: { marginTop: 5, color: '#8b591c', fontSize: 21, fontWeight: '900', textAlign: 'center' },
  careWarningBody: { marginTop: 12, color: '#6e6653', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  careTimingCopy: { marginTop: 12, alignItems: 'center' },
  careTimingBody: { color: '#6e6653', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  careTimingBodySecond: { marginTop: 10 },
  careWarningPopupButton: { alignSelf: 'stretch', marginTop: 18, borderRadius: 14, paddingVertical: 13, backgroundColor: '#d59a32' },
  // 見た目より少し広く、オオサンショウウオ本体をつかみやすくする。
  oosanTouchArea: { padding: 12, margin: -12 },
  levelOrbHitArea: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 42,
    left: '50%',
    marginLeft: -42,
    width: 84,
    height: 84,
    // 体長ボタンはオオサンより手前で常にタップできる。
    zIndex: 520,
    elevation: 55,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelOrb: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(228, 248, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(66, 183, 233, 0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.26,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 9,
  },
  levelOrbSegment: {
    position: 'absolute',
    width: 3,
    height: 7,
    borderRadius: 2,
  },
  levelOrbLabel: {
    color: '#176d99',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 11,
  },
  levelOrbValue: {
    color: '#126e9f',
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 25,
    fontVariant: ['tabular-nums'],
  },
  levelOrbUnit: {
    color: '#277ca7',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 10,
    marginTop: -2,
  },
  levelOrbPoints: {
    color: '#277ca7',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
    fontVariant: ['tabular-nums'],
  },
  levelOrbChargeFlash: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: 'rgba(103, 220, 255, 0.96)',
    backgroundColor: 'rgba(137, 230, 255, 0.24)',
  },
  growthPointFlight: {
    position: 'absolute',
    zIndex: 90,
    elevation: 30,
    minWidth: 86,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 253, 255, 0.97)',
    borderWidth: 2,
    borderColor: '#5bc6ef',
    shadowColor: '#063b52',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  growthPointFlightText: {
    color: '#0c82b4',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  phaseBadge: {
    position: 'absolute',
    // 右上の情報（設定）ボタンの直下。名前・昼夜表示と重ならない位置にする.
    top: Platform.OS === 'ios' ? 112 : 104,
    right: 10,
    zIndex: 9,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(16, 81, 109, 0.48)',
    borderWidth: 1,
    borderColor: 'rgba(230, 250, 255, 0.55)',
  },
  phaseBadgeText: {
    color: '#effbff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  nameBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 88 : 76,
    left: 14,
    zIndex: 520,
    elevation: 55,
    maxWidth: 134,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(16, 81, 109, 0.48)',
    borderWidth: 1,
    borderColor: 'rgba(230, 250, 255, 0.55)',
  },
  nameBadgeText: {
    flexShrink: 1,
    color: '#effbff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  growthStageNotice: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 156 : 142,
    left: 26,
    right: 26,
    zIndex: 45,
    alignItems: 'center',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(238, 251, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(74, 184, 225, 0.78)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 12,
  },
  growthStageNoticeLength: {
    color: '#2788b5',
    fontSize: 13,
    fontWeight: '900',
  },
  growthStageNoticeName: {
    marginTop: 1,
    color: '#225d76',
    fontSize: 20,
    fontWeight: '900',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    minHeight: Dimensions.get('window').height,
    width: '100%',
    flexGrow: 1,
  },
  container: {
    flex: 1,
    width: '100%',
    minHeight: Dimensions.get('window').height,
    position: 'relative',
  },
  loadingText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginTop: '50%',
  },
  mainCounterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
  },
  hudStatLabel: {
    width: 82,
    paddingTop: 4,
    color: '#e8faf5',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  mainCounterValueCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  mainCounterLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'baseline',
  },
  mainCounterInt: {
    color: '#f2fffc',
    fontSize: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  mainCounterDot: {
    color: '#e8fff8',
    fontSize: 24,
    fontWeight: '800',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  mainCounterFrac: {
    color: '#a8ffe8',
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  mainCounterUnit: {
    color: '#d2f5ec',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 4,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  phaseLabel: {
    marginTop: 4,
    color: '#e2faf4',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'left',
    paddingRight: 8,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  hudGlassPanel: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    backgroundColor: 'rgba(8, 28, 34, 0.22)',
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 2px 12px rgba(0,0,0,0.2)' as any }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
          elevation: 4,
        }),
  },
  lengthHudPanel: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  guideInfoButton: {
    paddingLeft: 7,
    paddingRight: 1,
    paddingTop: 1,
  },
  growthLevelText: {
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    color: '#e9fbf5',
    fontSize: 13,
    fontWeight: '800',
  },
  growthProgressText: {
    marginTop: 3,
    color: '#cce9e1',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  growthCareHint: {
    marginTop: 3,
    color: '#b7dfd4',
    fontSize: 10,
    fontWeight: '600',
  },
  affectionBlock: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  affectionHeader: { flexDirection: 'row', alignItems: 'center' },
  affectionLabel: {
    color: '#ffe8ee',
    fontSize: 13,
    fontWeight: '800',
  },
  affectionLevelText: {
    flex: 1,
    color: '#ffe0e8',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  affectionHeartsRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 29,
  },
  affectionHeartCarry: {
    marginRight: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  affectionHeartCarryText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  affectionHeartSet: { flexShrink: 1, color: '#ff8ca7', fontSize: 17, letterSpacing: 0.3 },
  affectionProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  affectionProgressTrack: {
    flex: 1,
    height: 7,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    marginRight: 8,
  },
  affectionProgressFill: {
    height: '100%',
    borderRadius: 5,
  },
  affectionGaugeFullEffect: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 5,
    opacity: 0.62,
  },
  affectionProgressText: {
    width: 116,
    color: '#f7dbe2',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  affectionHint: {
    marginTop: 2,
    color: '#efd9df',
    fontSize: 11,
  },
  growthMultHint: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    color: '#d0ebe4',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  growthMultFootnote: {
    marginTop: 4,
    color: '#d0ebe4',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  nextMilestoneText: {
    marginTop: 8,
    color: '#c8f5ea',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  hourlyGoalHint: {
    marginTop: 4,
    color: 'rgba(200, 235, 225, 0.88)',
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sparkleLayer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sparkleGlyph: {
    position: 'absolute',
    fontSize: 24,
  },
  milestoneBannerWrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 108,
    left: 14,
    right: 14,
    zIndex: 150,
    alignItems: 'center',
  },
  milestoneBannerText: {
    backgroundColor: 'rgba(20, 45, 55, 0.92)',
    color: '#e8faf5',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(18, 38, 44, 0.97)',
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(140, 220, 200, 0.35)',
  },
  modalTitle: {
    color: '#e8faf5',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalCelebrateName: {
    color: '#7ee8d8',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  modalBody: {
    color: 'rgba(230, 245, 240, 0.9)',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
    textAlign: 'center',
  },
  modalListItem: {
    color: 'rgba(230, 245, 240, 0.92)',
    fontSize: 14,
    marginBottom: 4,
  },
  modalButton: {
    marginTop: 8,
    backgroundColor: 'rgba(76, 175, 80, 0.9)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  nightVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#1a1a2e',
    zIndex: 1,
  },
  /** タップ波紋：オオサン（14）より手前（反応が分かりやすい） */
  tapRippleLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 18,
  },
  moonBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    left: 14,
    zIndex: 9,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(20, 24, 48, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(200, 220, 255, 0.28)',
  },
  moonBadgeLabel: {
    marginLeft: 6,
    color: 'rgba(230, 240, 255, 0.95)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sunBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    left: 14,
    zIndex: 9,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 180, 60, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  sunBadgeLabel: {
    marginLeft: 6,
    color: 'rgba(60, 40, 10, 0.92)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dayBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    left: 14,
    zIndex: 9,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(100, 180, 220, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  dayBadgeLabel: {
    marginLeft: 6,
    color: 'rgba(10, 45, 65, 0.98)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(255, 255, 255, 0.35)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 1,
  },
  /** お世話演出の落下パーティクル（操作は透過） */
  fallingParticleOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 8,
    overflow: 'visible',
  },
  /** 情報表示はオオサンより奥。操作ボタンぶんだけ上へずらし、従来の位置を保つ。 */
  bottomInfoStack: {
    position: 'absolute',
    left: 10,
    right: 10,
    // 下部操作列（約71px）の上。これによりHUDの画面上の位置は従来と変わらない。
    bottom: Platform.select({ ios: 123, android: 91, default: 83 }),
    zIndex: 12,
    elevation: 10,
  },
  /** ごはん／おみず／なでるは、オオサン本体（450）より必ず手前。 */
  bottomActionStack: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: Platform.select({ ios: 52, android: 20, default: 12 }),
    zIndex: 500,
    elevation: 50,
  },
  deadState: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  deadMessagePanel: {
    alignSelf: 'stretch',
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(8, 28, 34, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  deadTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 26,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  deadBody: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 8,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  deadRestartAction: {
    marginTop: 18,
    minWidth: 260,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: 'rgba(33, 150, 243, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  deadRestartText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  dailyLogStrip: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    marginBottom: 8,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  dailyMissionCard: {
    width: '100%',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(12, 67, 80, 0.58)',
    borderWidth: 1,
    borderColor: 'rgba(162, 234, 210, 0.32)',
  },
  dailyMissionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dailyMissionTitle: { color: '#e4fff3', fontSize: 13, fontWeight: '900' },
  dailyMissionReward: { color: '#c8f1df', fontSize: 11, fontWeight: '800' },
  dailyMissionRewardDone: { color: '#ffe38a' },
  dailyMissionTasks: { flexDirection: 'row', justifyContent: 'space-between' },
  dailyMissionTask: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dailyMissionTaskText: { marginLeft: 3, color: '#d9efeb', fontSize: 10, fontWeight: '700' },
  dailyMissionTaskDone: { color: '#8be2bb' },
  gaugeBlock: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: Platform.select({ ios: 14, default: 10 }),
  },
  gaugeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 11,
  },
  gaugeRowLast: {
    marginBottom: 0,
  },
  gaugeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 82,
    paddingTop: 1,
  },
  gaugeLabel: {
    width: 82,
    color: '#e8faf5',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  gaugeLabelShrink: {
    color: '#e8faf5',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 2,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  viscosityWarnIcon: {
    marginLeft: 2,
  },
  /** 白い i は常設の説明、少し離した黄色 ! は今の残量への注意として見分ける。 */
  gaugeInfoIcon: {
    marginLeft: 2,
  },
  gaugeWarningButton: {
    marginLeft: 7,
  },
  gaugeTrack: {
    flex: 1,
    height: 25,
    marginHorizontal: 8,
  },
  gaugeBarBackground: { height: 10, borderRadius: 6, backgroundColor: 'rgba(0, 0, 0, 0.22)', overflow: 'hidden' },
  gaugeFill: {
    height: '100%',
    borderRadius: 6,
  },
  gaugeFillViscosity: {
    backgroundColor: 'rgba(33, 150, 243, 0.88)',
  },
  gaugeDivider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.72)' },
  gaugeDividerFirst: { left: '33.333%' },
  gaugeDividerSecond: { left: '66.666%' },
  gaugeRewardScale: { flexDirection: 'row', marginTop: 2 },
  gaugeRewardLabel: { flex: 1, color: 'rgba(222, 244, 240, 0.78)', fontSize: 9, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  gaugePct: {
    width: 38,
    paddingTop: 1,
    textAlign: 'right',
    color: '#d2f5ec',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: Platform.select({ ios: 4, default: 0 }),
  },
  actionItem: {
    flex: 1,
    alignItems: 'stretch',
  },
  actionItemFeed: {
    marginRight: 6,
  },
  actionItemWater: {
    marginHorizontal: 3,
  },
  actionItemPet: {
    marginLeft: 6,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionBtnFeed: {
    backgroundColor: 'rgba(76, 175, 80, 0.88)',
  },
  actionBtnWater: {
    backgroundColor: 'rgba(33, 150, 243, 0.88)',
  },
  actionBtnBonus: {
    borderWidth: 3,
    borderColor: '#f5cf5d',
    shadowColor: '#f5cf5d',
    shadowOpacity: 0.7,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  actionBtnFeedNoPoint: {
    backgroundColor: 'rgba(109, 151, 113, 0.72)',
    borderColor: 'rgba(224, 244, 226, 0.5)',
  },
  actionBtnWaterNoPoint: {
    backgroundColor: 'rgba(101, 145, 178, 0.72)',
    borderColor: 'rgba(224, 234, 236, 0.52)',
  },
  actionBtnPet: {
    backgroundColor: 'rgba(232, 100, 137, 0.9)',
  },
  bonusPetSparkleLeft: { position: 'absolute', top: 5, left: 8, opacity: 0.95 },
  bonusPetSparkleRight: { position: 'absolute', bottom: 5, right: 8, opacity: 0.95 },
  /** 上限後も反応はするが、今日はなつきが増えないことを淡いピンクで示す。 */
  actionBtnPetResting: {
    backgroundColor: 'rgba(222, 151, 171, 0.68)',
    borderColor: 'rgba(255, 235, 241, 0.62)',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionBtnTextBonus: {
    fontSize: 12,
    letterSpacing: 0,
  },
  actionBtnTextNoPoint: {
    color: '#edf4f5',
  },
  actionPointSlot: {
    height: 25,
    paddingTop: 3,
    alignItems: 'center',
    paddingHorizontal: 1,
  },
  actionPointHint: {
    minWidth: 48,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    color: '#1685b6',
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  actionPointHintBonus: {
    color: '#aa7814',
    borderWidth: 1,
    borderColor: '#efd077',
  },
  actionPointHintNoPoint: {
    color: '#708088',
    backgroundColor: 'rgba(236, 241, 242, 0.94)',
  },
  bonusWaterParticle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusWaterSparkle: {
    position: 'absolute',
    right: -5,
    top: -7,
    color: '#ffe67d',
    fontSize: 15,
    fontWeight: '900',
  },
  bonusPetParticle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusPetFallingHeart: {
    color: '#f2b938',
    fontWeight: '900',
    textShadowColor: 'rgba(255, 250, 204, 0.96)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bonusPetFallingSparkle: {
    position: 'absolute',
    right: -6,
    top: -9,
    color: '#fff3a0',
    fontSize: 16,
    fontWeight: '900',
  },
  actionPointHintHidden: {
    opacity: 0,
  },
  riverBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 0,
  },
  /** 下部 HUD（12）より手前。大きさに関わらず同じ重なり順 */
  oosanContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // 体長リング・設定アイコンより手前に泳ぐ。モーダル類は別レイヤーのため常に前面のまま。
    zIndex: 450,
    elevation: 30,
    overflow: 'visible',
  },
  oosan: {
    width: 100,
    height: 80,
  },
  petHeartLayer: {
    position: 'absolute',
    left: '50%',
    top: 0,
    overflow: 'visible',
  },
  petHeart: {
    position: 'absolute',
    color: '#ff5b8a',
    fontSize: 30,
    fontWeight: '900',
    textShadowColor: 'rgba(255, 255, 255, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  careSpeechBubble: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '82%',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(42, 112, 139, 0.36)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  careSpeechText: {
    color: '#286178',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  growthStageUpBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 22,
    backgroundColor: 'rgba(4, 29, 45, 0.7)',
  },
  growthStageUpCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 23,
    paddingBottom: 20,
    backgroundColor: '#eefbff',
    borderWidth: 2,
    borderColor: 'rgba(126, 213, 240, 0.95)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 18,
  },
  growthLevelUpCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 23,
    paddingBottom: 20,
    backgroundColor: '#f2fcff',
    borderWidth: 2,
    borderColor: 'rgba(126, 213, 240, 0.95)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 18,
  },
  growthStageUpEyebrow: { color: '#2788b5', fontSize: 14, fontWeight: '800', letterSpacing: 0.8 },
  growthStageUpTitle: { marginTop: 5, color: '#1d5971', fontSize: 25, fontWeight: '900', textAlign: 'center' },
  growthStageUpImage: { width: '100%', height: 150, marginTop: 5 },
  growthLevelUpImage: { width: '100%', height: 128, marginTop: 7, marginBottom: 5 },
  growthStageUpName: { color: '#1d769d', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  growthStageUpBody: { marginTop: 6, color: '#397085', fontSize: 14, textAlign: 'center' },
  growthStageUpButton: { alignSelf: 'stretch', marginTop: 18, borderRadius: 15, paddingVertical: 13, backgroundColor: '#3baee0' },
  growthStageUpButtonText: { color: '#fff', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  adultEvolutionBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 22,
    backgroundColor: 'rgba(4, 29, 45, 0.78)',
  },
  adultEvolutionCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    backgroundColor: '#eefbff',
    borderWidth: 2,
    borderColor: 'rgba(126, 213, 240, 0.95)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 18,
  },
  adultEvolutionEyebrow: {
    color: '#2788b5',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  adultEvolutionTitle: {
    marginTop: 5,
    color: '#1d5971',
    fontSize: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
  adultEvolutionImage: {
    width: '100%',
    height: 175,
    marginTop: 8,
  },
  adultEvolutionBody: {
    color: '#397085',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  adultEvolutionButton: {
    alignSelf: 'stretch',
    marginTop: 18,
    borderRadius: 15,
    paddingVertical: 13,
    backgroundColor: '#3baee0',
  },
  adultEvolutionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  affectionLevelUpBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 22,
    backgroundColor: 'rgba(48, 20, 40, 0.67)',
  },
  affectionLevelUpCard: {
    width: '100%',
    maxWidth: 350,
    borderRadius: 24,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 20,
    backgroundColor: '#fff7fa',
    borderWidth: 2,
    borderColor: '#ffb9c9',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 18,
  },
  affectionLevelUpEyebrow: { color: '#d85d7b', fontSize: 14, fontWeight: '900', letterSpacing: 0.8 },
  affectionLevelUpHearts: { marginTop: 7, color: '#ee6d8c', fontSize: 28, letterSpacing: 3 },
  affectionLevelUpTitle: { marginTop: 4, color: '#a9435e', fontSize: 23, fontWeight: '900', textAlign: 'center' },
  affectionLevelUpName: { marginTop: 5, color: '#d85d7b', fontSize: 17, fontWeight: '900', textAlign: 'center' },
  affectionLevelUpBody: { marginTop: 13, color: '#805866', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  affectionLevelUpButton: { alignSelf: 'stretch', marginTop: 18, borderRadius: 15, paddingVertical: 13, backgroundColor: '#ee7992' },
  affectionLevelUpButtonText: { color: '#fff', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  dailyLog: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

export default App;
