import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  Easing,
  AppState as RNAppState,
  Modal,
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
  processGrowth,
  processCondition,
  generateDailyLog,
  formatOosanLengthCm,
  GROWTH_TARGET_CM,
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
  backgroundGaugeDecayMultiplier,
  DEFAULT_NIGHT_CARE_MULTIPLIER,
} from './src/logic';
import { DebugTimeProvider, useDebugTime } from './src/DebugTimeContext';
import { DebugOverlay } from './src/DebugOverlay';
import { LegalInfoModal } from './src/LegalInfoModal';
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
  notifyFullnessEmptyNow,
  notifyViscosityEmptyNow,
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
const FULLNESS_SECONDS_PER_ONE_PERCENT = 15;

/** ヌメリが平均して 1% 減るまでの目安秒数（logic.ts のバックグラウンド 12h/24h 設計と揃えること） */
const VISCOSITY_SECONDS_PER_ONE_PERCENT = 30;

const FULLNESS_DECAY_PER_SECOND = 1 / FULLNESS_SECONDS_PER_ONE_PERCENT;
const VISCOSITY_DECAY_PER_SECOND = 1 / VISCOSITY_SECONDS_PER_ONE_PERCENT;

/**
 * フォアグラウンド中のおなか・ヌメリ減少に掛ける倍率（基準は各 SECONDS_PER_ONE_PERCENT）。
 * 開いているときの目安: おなか 100→0 約 12.5 分、ヌメリ 約 25 分。
 */
const GAUGE_DECAY_MULT_FOREGROUND = 2;

/**
 * バックグラウンド／アプリ非表示時の減少倍率（おなか・ヌメリ共通）。
 * 1/6 なら目安: おなか 100→0 約 2.5 時間、ヌメリ 約 5 時間（ジッター除く）。
 * もっとゆっくりにするなら 1/8 などに下げる。
 */
const GAUGE_DECAY_MULT_BACKGROUND = 1 / 6;

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

type PfxKind = 'feed' | 'water';

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

const FallingImageParticle: React.FC<{ p: FallingPfx; fallDistance: number }> = ({
  p,
  fallDistance,
}) => {
  const t = useRef(new Animated.Value(0)).current;
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
      <Image source={src} style={{ width: p.size, height: p.size }} resizeMode="contain" />
    </Animated.View>
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
            duration: 920,
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
      style={[StyleSheet.absoluteFillObject, styles.sparkleLayer, { opacity: op, zIndex: 200 }]}
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
  const [imagesLoaded, setImagesLoaded] = useState(Platform.OS === 'web');
  const [isMovingRight, setIsMovingRight] = useState(false); // オオサンショウウオが右に動いているかどうか
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  // オオサンショウウオの位置アニメーション（X座標とY座標）
  const oosanXAnim = React.useRef(new Animated.Value(0)).current;
  const oosanYAnim = React.useRef(new Animated.Value(0)).current;
  const oosanLayoutSizeRef = useRef(48);
  const oosanLengthCmRef = useRef(0);
  const [, setGrowthTick] = useState(0);
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
  const prevFullnessNotifyRef = useRef<number | null>(null);
  const prevViscosityNotifyRef = useRef<number | null>(null);
  /** タップ移動と自動うろうろの競合を避ける（値が変わったら進行中の遅延チェーンは捨てる） */
  const wanderGenRef = useRef(0);
  const moveOosanRef = useRef<(() => void) | null>(null);
  const [tapRipples, setTapRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const tapRippleSerial = useRef(0);
  /** タップ座標を子 View の location ではなく Pressable 全体に対して取る */
  const mainPressableRef = useRef<View | null>(null);
  const [legalInfoOpen, setLegalInfoOpen] = useState(false);
  const removeTapRipple = useCallback((id: number) => {
    setTapRipples((list) => list.filter((t) => t.id !== id));
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
  }, [bannerAnim]);

  const applyDebugGauges = useCallback(
    (patch: { fullness?: number; viscosity?: number }) => {
      setState((s) => {
        if (!s || s.condition === 'dead') return s;
        const n = {
          ...s,
          ...(patch.fullness !== undefined
            ? { fullness: Math.max(0, Math.min(100, patch.fullness)) }
            : {}),
          ...(patch.viscosity !== undefined
            ? { viscosity: Math.max(0, Math.min(100, patch.viscosity)) }
            : {}),
        };
        void saveState(n);
        return n;
      });
    },
    []
  );

  const spawnBurst = useCallback((kind: PfxKind) => {
    const count = 3;
    const batch: FallingPfx[] = [];
    for (let i = 0; i < count; i++) {
      const base = kind === 'feed' ? 32 : 26;
      const size = base + Math.floor(Math.random() * 20);
      const isWater = kind === 'water';
      batch.push({
        id: ++particleSerial.current,
        kind,
        leftPct: 6 + Math.random() * 88,
        size,
        drift: (Math.random() - 0.5) * (isWater ? 14 : 56),
        delayMs: Math.floor(Math.random() * 500),
        durationMs: 4200 + Math.floor(Math.random() * 1800),
        spinFromDeg: (Math.random() - 0.5) * (isWater ? 6 : 22),
        spinToDeg: isWater ? 25 + Math.random() * 35 : 100 + Math.random() * 120,
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
    spawnBurst('feed');
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = { ...s, fullness: Math.min(100, s.fullness + 28) };
      void saveState(n);
      return n;
    });
  }, [spawnBurst]);

  const onWater = useCallback(() => {
    spawnBurst('water');
    setState((s) => {
      if (!s || s.condition === 'dead') return s;
      const n = { ...s, viscosity: Math.min(100, s.viscosity + 28) };
      void saveState(n);
      return n;
    });
  }, [spawnBurst]);

  // 画像とGIFをプリロード
  useEffect(() => {
    const loadAssets = async () => {
      try {
        if (Platform.OS !== 'web') {
          await Asset.loadAsync([
            require('./assets/images/kamogawa_tate2.png'),
            require('./assets/images/sansyo_toka2.gif'),
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

  // 初回マウント時に状態を読み込む
  useEffect(() => {
    const initializeState = async () => {
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
      const fullnessBeforeOffline = loadedState.fullness;
      const viscosityBeforeOffline = loadedState.viscosity;
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
      const backlog = findBackloggedMilestones(updatedState, now);
      if (backlog.length > 0) {
        const pages = paginateOfflineBacklog(backlog);
        offlineBacklogModalMetaRef.current = {
          total: backlog.length,
          pageCount: pages.length,
        };
        setOfflineBacklogPageQueue(pages);
        skipNextMilestoneDiffRef.current = true;
      }
      const today = new Date().toISOString().split('T')[0];
      
      // 状態を更新
      updatedState = processCondition(updatedState);
      updatedState = processGrowth(updatedState);
      
      // 日次ログを生成
      const newLog = generateDailyLog(updatedState);
      if (updatedState.lastVisitDate === today) {
        updatedState.latestLog = newLog;
      }

      if (updatedState.condition !== 'dead') {
        if (fullnessBeforeOffline > 0 && updatedState.fullness <= 0) {
          void notifyFullnessEmptyNow();
        }
        if (viscosityBeforeOffline > 0 && updatedState.viscosity <= 0) {
          void notifyViscosityEmptyNow();
        }
      }

      setState(updatedState);
      await saveState(updatedState);
    };

    initializeState();
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
    if (!state || state.condition === 'dead') {
      prevFullnessNotifyRef.current = state?.fullness ?? null;
      prevViscosityNotifyRef.current = state?.viscosity ?? null;
      return;
    }
    const pf = prevFullnessNotifyRef.current;
    const pv = prevViscosityNotifyRef.current;
    prevFullnessNotifyRef.current = state.fullness;
    prevViscosityNotifyRef.current = state.viscosity;
    if (pf === null || pv === null) return;
    if (pf > 0 && state.fullness <= 0) {
      void notifyFullnessEmptyNow();
    }
    if (pv > 0 && state.viscosity <= 0) {
      void notifyViscosityEmptyNow();
    }
  }, [state?.fullness, state?.viscosity, state?.condition]);

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
      const vn = new Date(Date.now() + timeOffsetRef.current);
      const nightNow = computeIsNight(vn);
      const nightCareMult = nightCareRef.current ?? DEFAULT_NIGHT_CARE_MULTIPLIER;
      setState((prev) => {
        if (!prev || prev.condition === 'dead') return prev;
        const night = nightNow;
        const mult = computeGrowthMultiplier(
          prev.fullness,
          prev.viscosity,
          night,
          nightCareMult
        );
        const nextCm = Math.min(
          GROWTH_TARGET_CM,
          prev.bodyLengthCm + GROWTH_CM_PER_SECOND * mult
        );
        const fj = sampleDecayJitter();
        const vj = sampleDecayJitter();
        const fgAdd =
          RNAppState.currentState === 'active' ? Math.round(1000 * mult) : 0;
        const tickNow = Date.now() + timeOffsetRef.current;
        const gaugeDecayMult =
          RNAppState.currentState === 'active'
            ? GAUGE_DECAY_MULT_FOREGROUND
            : backgroundGaugeDecayMultiplier(prev, tickNow);
        const fullnessLoss = FULLNESS_DECAY_PER_SECOND * fj * gaugeDecayMult;
        const viscosityLoss = VISCOSITY_DECAY_PER_SECOND * vj * gaugeDecayMult;
        const next: AppState = {
          ...prev,
          bodyLengthCm: nextCm,
          fullness: Math.max(0, prev.fullness - fullnessLoss),
          viscosity: Math.max(0, prev.viscosity - viscosityLoss),
          sessionForegroundMs: prev.sessionForegroundMs + fgAdd,
          lastGrowthTickMs: Date.now(),
        };
        void saveState(next);
        return next;
      });
      setGrowthTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [state?.condition]);

  useEffect(() => {
    if (!state || state.condition === 'dead') return;
    if (skipNextMilestoneDiffRef.current) {
      skipNextMilestoneDiffRef.current = false;
      prevFullStateRef.current = state;
      return;
    }
    const prev = prevFullStateRef.current;
    prevFullStateRef.current = state;
    if (prev == null) return;
    const newly = findNewlyCompletedMilestones(prev, state, getNow().getTime());
    if (newly.length > 0) {
      setCelebrationQueue((q) => [...q, ...newly]);
    }
  }, [state, getNow]);

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
        if (wanderGenRef.current !== genAtStart) return;
        Animated.delay(waitDuration).start(({ finished: waitDone }) => {
          if (!waitDone) return;
          if (wanderGenRef.current !== genAtStart) return;
          moveOosan();
        });
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

  const maybePetOnPress = useCallback(() => {
    if (!state || state.condition !== 'healthy') return;
    if (Math.random() >= 0.1) return;
    setIsPetting(true);
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
    ]).start(() => {
      setIsPetting(false);
    });
  }, [state, scaleAnim]);

  /** タップ位置へ向きを合わせて移動し、その後また自動うろうろへ */
  const handleContainerPress = useCallback(
    (e: GestureResponderEvent) => {
      if (!state || state.condition === 'dead') return;
      maybePetOnPress();
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
        const targetX = minX + tapNormX * (maxX - minX);
        const targetY = minY + tapNormY * (maxY - minY);
        setIsMovingRight(targetX > currentX);
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
    [state, maybePetOnPress, getWanderBounds, oosanXAnim, oosanYAnim]
  );


  if (!state) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const lengthCm = Math.min(GROWTH_TARGET_CM, state.bodyLengthCm);
  const lengthCmText = formatOosanLengthCm(lengthCm);
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
  const growthMult = computeGrowthMultiplier(
    state.fullness,
    state.viscosity,
    isNight,
    debugNightCareMultiplier ?? DEFAULT_NIGHT_CARE_MULTIPLIER
  );
  const multLabel = formatGrowthMultiplier(growthMult);
  const phaseLabel = getGrowthPhaseLabel(lengthCm);
  const nowMs = virtualNow.getTime();
  const nextMilestoneLine =
    state.condition !== 'dead'
      ? getNextMilestoneLine(state, nowMs, growthMult)
      : null;
  const hourlyGoalHint =
    state.condition !== 'dead' ? hourlyGoalLabel(state, nowMs) : null;
  // 夜間（logic.computeIsNight: 19〜6時）のみ nightDim=1。昼は 0 でベールは見えない。
  const nightOverlayOpacity = nightDim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.28],
  });
  const shortSide = Math.min(screenWidth, screenHeight);
  // 100cm 時: 短辺の約2倍幅。中央配置のためおおむね半分が画面外に出る目安（cm 表示とは別スケール）
  const oosanMaxWidthPx = shortSide * 2;
  const growthT = Math.min(1, lengthCm / 100);
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
            <Ionicons name="moon" size={22} color="rgba(230, 240, 255, 0.92)" />
            <Text style={styles.moonBadgeLabel}>夜</Text>
          </View>
        )}

        {state.condition !== 'dead' && showMorningBadge && (
          <View style={styles.sunBadge} pointerEvents="none">
            <Ionicons name="sunny" size={22} color="rgba(255, 248, 220, 0.98)" />
            <Text style={styles.sunBadgeLabel}>朝</Text>
          </View>
        )}

        {state.condition !== 'dead' && showDayBadge && (
          <View style={styles.dayBadge} pointerEvents="none">
            <Ionicons name="partly-sunny" size={22} color="rgba(255, 252, 235, 0.96)" />
            <Text style={styles.dayBadgeLabel}>昼</Text>
          </View>
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
              <ExpoImage
                source={require('./assets/images/sansyo_toka2.gif')}
                style={[
                  styles.oosan,
                  { width: size, height: size * 0.8 },
                  isMovingRight && { transform: [{ scaleX: -1 }] },
                ]}
                contentFit="contain"
              />
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

        <View style={styles.bottomStack}>
          <View style={styles.dailyLogStrip}>
            <Animated.Text style={[styles.dailyLog, { opacity: dailyLogOpacity }]}>
              {state.latestLog}
            </Animated.Text>
          </View>
          {state.condition !== 'dead' && (
            <>
            <View style={[styles.hudGlassPanel, styles.lengthHudPanel]}>
              <View style={styles.mainCounterRow}>
                <Text style={styles.hudStatLabel}>体長</Text>
                <MainLengthCounter cmText={lengthCmText} phase={phaseLabel} />
              </View>
              <Text style={styles.growthMultHint}>成長倍率 {multLabel}</Text>
              <Text style={styles.growthMultFootnote}>
                基準は x1。おなか・ヌメリが高いほど加速（満タンで昼あたり最大 x3 前後、夜はさらにボーナス）
              </Text>
              {nextMilestoneLine && (
                <Text style={styles.nextMilestoneText}>{nextMilestoneLine.line}</Text>
              )}
              {hourlyGoalHint && (
                <Text style={styles.hourlyGoalHint}>{hourlyGoalHint}</Text>
              )}
            </View>
            <View style={[styles.hudGlassPanel, styles.gaugeBlock]}>
              <View style={styles.gaugeRow}>
                <View style={styles.gaugeLabelRow}>
                  <Text style={styles.gaugeLabelShrink}>おなか</Text>
                  {state.fullness < 38 && (
                    <Ionicons
                      name="warning"
                      size={16}
                      color="#ffcc80"
                      style={styles.viscosityWarnIcon}
                    />
                  )}
                </View>
                <View style={styles.gaugeTrack}>
                  <View
                    style={[
                      styles.gaugeFill,
                      {
                        width: `${Math.round(state.fullness)}%`,
                        backgroundColor: fullnessBarColor(state.fullness),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.gaugePct}>{Math.round(state.fullness)}%</Text>
              </View>
              <View style={[styles.gaugeRow, styles.gaugeRowLast]}>
                <View style={styles.gaugeLabelRow}>
                  <Text style={styles.gaugeLabelShrink}>ヌメリ</Text>
                  {state.viscosity < 38 && (
                    <Ionicons
                      name="warning"
                      size={16}
                      color="#ffcc80"
                      style={styles.viscosityWarnIcon}
                    />
                  )}
                </View>
                <View style={styles.gaugeTrack}>
                  <View
                    style={[
                      styles.gaugeFill,
                      styles.gaugeFillViscosity,
                      { width: `${Math.round(state.viscosity)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.gaugePct}>{Math.round(state.viscosity)}%</Text>
              </View>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnFeed]}
                onPress={onFeed}
                activeOpacity={0.85}
              >
                <Text style={styles.actionBtnText}>Feed</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnWater]}
                onPress={onWater}
                activeOpacity={0.85}
              >
                <Text style={styles.actionBtnText}>Water</Text>
              </TouchableOpacity>
            </View>
            </>
          )}
        </View>
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>達成！</Text>
            <Text style={styles.modalCelebrateName}>{celebrationItem?.name}</Text>
            <Text style={styles.modalBody}>
              {celebrationItem?.tier === 'high'
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
        </View>
      </Modal>

      <DebugOverlay
        onApplyBodyLengthCm={applyDebugBodyLengthCm}
        onApplyGauges={applyDebugGauges}
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
  /** DebugOverlay の FAB は left: 62（10+44+8）で隣接 */
  legalFab: {
    position: 'absolute',
    left: 10,
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    zIndex: 1,
  },
  /** タップ波紋：オオサン（14）より手前（反応が分かりやすい） */
  tapRippleLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18,
  },
  moonBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    right: 14,
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
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sunBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    right: 14,
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
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dayBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    right: 14,
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
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(255, 255, 255, 0.35)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 1,
  },
  /** 下部 HUD・オオサンより奥で、操作は透過 */
  fallingParticleOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 8,
    overflow: 'visible',
  },
  bottomStack: {
    position: 'absolute',
    left: 10,
    right: 10,
    // iPhone のホームインジケータ・システムジェスチャと Feed/Water が被らないよう余白を多めに
    bottom: Platform.select({ ios: 52, android: 20, default: 12 }),
    zIndex: 12,
    elevation: 10,
  },
  dailyLogStrip: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  gaugeBlock: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: Platform.select({ ios: 14, default: 10 }),
  },
  gaugeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  gaugeRowLast: {
    marginBottom: 0,
  },
  gaugeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 82,
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
  gaugeTrack: {
    flex: 1,
    height: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 6,
  },
  gaugeFillViscosity: {
    backgroundColor: 'rgba(33, 150, 243, 0.88)',
  },
  gaugePct: {
    width: 38,
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
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    minWidth: 120,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionBtnFeed: {
    backgroundColor: 'rgba(76, 175, 80, 0.88)',
    marginRight: 6,
  },
  actionBtnWater: {
    backgroundColor: 'rgba(33, 150, 243, 0.88)',
    marginLeft: 6,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
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
    zIndex: 14,
    elevation: 14,
    overflow: 'visible',
  },
  oosan: {
    width: 100,
    height: 80,
  },
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
