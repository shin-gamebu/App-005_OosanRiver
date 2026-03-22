import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Animated, Dimensions, Platform, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { Image as ExpoImage } from 'expo-image';
import {
  AppState,
  Condition,
  createInitialState,
  processGrowth,
  processCondition,
  generateDailyLog,
  formatOosanLengthCm,
  getOosanLengthCm,
} from './src/logic';

// AsyncStorage のキー
const STORAGE_KEY = 'oosanRiverState';

// AsyncStorage から状態を読み込む
export const loadState = async (): Promise<AppState> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AppState;
      if (typeof parsed.growthAnchorMs !== 'number' || !Number.isFinite(parsed.growthAnchorMs)) {
        return { ...parsed, growthAnchorMs: Date.now() };
      }
      return parsed;
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

// メインコンポーネント
const App: React.FC = () => {
  const [state, setState] = useState<AppState | null>(null);
  const [isPetting, setIsPetting] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(Platform.OS === 'web');
  const [isMoving, setIsMoving] = useState(false); // オオサンショウウオが動いているかどうか
  const [isMovingRight, setIsMovingRight] = useState(false); // オオサンショウウオが右に動いているかどうか
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  // オオサンショウウオの位置アニメーション（X座標とY座標）
  const oosanXAnim = React.useRef(new Animated.Value(0)).current;
  const oosanYAnim = React.useRef(new Animated.Value(0)).current;
  const oosanLayoutSizeRef = useRef(48);
  const [, setGrowthTick] = useState(0);

  // 画像とGIFをプリロード
  useEffect(() => {
    const loadAssets = async () => {
      try {
        if (Platform.OS !== 'web') {
          await Asset.loadAsync([
            require('./assets/images/kamogawa_tate2.png'),
            require('./assets/images/sansyo_toka2.gif'),
            require('./assets/images/baby_oosan.png'),
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
      const loadedState = await loadState();
      const today = new Date().toISOString().split('T')[0];
      
      // 状態を更新
      let updatedState = processCondition(loadedState);
      updatedState = processGrowth(updatedState);
      
      // 日次ログを生成
      const newLog = generateDailyLog(updatedState);
      if (updatedState.lastVisitDate === today) {
        updatedState.latestLog = newLog;
      }
      
      setState(updatedState);
      await saveState(updatedState);
    };

    initializeState();
  }, []);

  useEffect(() => {
    if (!state || state.condition === 'dead') return;
    const id = setInterval(() => setGrowthTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state?.condition]);

  // オオサンショウウオのうろうろアニメーション（画面上部20%以外を自由に移動）
  useEffect(() => {
    const moveOosan = () => {
      const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
      
      const oosanWidth = oosanLayoutSizeRef.current;
      
      // X座標: 画面内に収まるように左右に移動（オオサンショウウオのサイズを考慮）
      // 画面の中央を基準に、オオサンショウウオが画面端から余裕を持って移動できる範囲
      const maxOffsetX = (screenWidth / 2) - (oosanWidth / 2) - 20; // 画面端から20px余裕
      const minX = -maxOffsetX;
      const maxX = maxOffsetX;
      const targetX = minX + Math.random() * (maxX - minX);
      
      // Y座標: 画面上部20%を避けて、それ以外を自由に移動
      // 初期位置は bottom: screenHeight * 0.3（画面の下から30%の位置）
      // translateYは相対的な移動なので、初期位置からの移動量を計算
      // 画面上部20%を避ける = 画面の下から80%以上の位置には行かない
      // つまり、初期位置（下から30%）から上に50%分移動できる
      const minY = -screenHeight * 0.5; // 上方向への最大移動（画面の下から80%の位置まで）
      const maxY = screenHeight * 0.25;   // 下方向への最大移動（画面の下から5%の位置まで）

      // 初回は現在位置が0なので、中央付近からスタートさせる
      const currentY = (oosanYAnim as any)._value || 0;
      if (currentY === 0) {
        oosanYAnim.setValue((minY + maxY) / 2);
      }

      const targetY = minY + Math.random() * (maxY - minY);
      
      // ゆっくり移動するように、移動時間を長めに設定（5〜10秒）
      const moveDuration = 5000 + Math.random() * 5000;
      
      // 待機時間（1〜4秒、たまに長めに10〜15秒）
      const waitDuration = Math.random() < 0.2 
        ? 10000 + Math.random() * 5000  // 20%の確率で長めに止まる
        : 1000 + Math.random() * 3000;
      
      // WebプラットフォームではuseNativeDriverはサポートされていない
      const useNativeDriver = Platform.OS !== 'web';
      
      // 移動方向を判定（現在のX座標と目標X座標を比較）
      // 目標X座標が現在のX座標より大きい場合は右に動いている
      const currentX = (oosanXAnim as any)._value || 0;
      setIsMovingRight(targetX > currentX);
      
      // 移動開始
      setIsMoving(true);
      
      Animated.sequence([
        Animated.parallel([
          Animated.timing(oosanXAnim, {
            toValue: targetX,
            duration: moveDuration,
            useNativeDriver: useNativeDriver,
          }),
          Animated.timing(oosanYAnim, {
            toValue: targetY,
            duration: moveDuration,
            useNativeDriver: useNativeDriver,
          }),
        ]),
        Animated.delay(waitDuration),
      ]).start(() => {
        // 移動終了（待機中）
        setIsMoving(false);
        moveOosan(); // 次の移動を開始
      });
    };
    
    moveOosan();

    return () => {
      oosanXAnim.stopAnimation();
      oosanYAnim.stopAnimation();
    };
  }, []);


  // なでる挙動（タップ）
  const handlePress = () => {
    if (!state) return;
    
    // 10% の確率でアニメーション（weak状態のときは動かない）
    if (Math.random() < 0.1 && state.condition === 'healthy') {
      setIsPetting(true);
      // WebプラットフォームではuseNativeDriverはサポートされていない
      const useNativeDriver = Platform.OS !== 'web';
      
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.05,
          duration: 200,
          useNativeDriver: useNativeDriver,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: useNativeDriver,
        }),
      ]).start(() => {
        setIsPetting(false);
      });
    }
  };


  if (!state) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const lengthCm = getOosanLengthCm(state.growthAnchorMs);
  const lengthCmText = formatOosanLengthCm(lengthCm);
  const maxBodyPx = Math.min(screenWidth, screenHeight) * 0.92;
  // 体長表示がほぼ 0 のときも見えるよう、ピクセル幅は下限〜上限の間で補間（cm 表示とは別スケール）
  const growthT = Math.min(1, lengthCm / 100);
  const minOosanPx = Math.min(64, Math.max(48, maxBodyPx * 0.14));
  const sizeMax = Math.max(minOosanPx, maxBodyPx);
  const size = minOosanPx + growthT * (sizeMax - minOosanPx);
  oosanLayoutSizeRef.current = size;
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
  
  // パーセンテージ値を計算
  const oosanBottom = screenHeight * 0.3;
  

  return (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <TouchableOpacity 
      style={styles.container} 
      onPress={handlePress}
      activeOpacity={1}
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
              Platform.OS === 'web' && {
                // Webでの画像品質向上
                imageRendering: 'high-quality' as any,
                // Webでは縦全体を表示するために高さを画面に合わせる
                minHeight: screenHeight,
              },
            ]}
            resizeMode={Platform.OS === 'web' ? 'contain' : 'cover'}
          />
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
              source={
                isMoving
                  ? require('./assets/images/sansyo_toka2.gif')
                  : require('./assets/images/baby_oosan.png')
              }
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
      
        {/* 日次ログ */}
        <View style={styles.dailyLogContainer}>
          <Text style={styles.dailyLog}>{state.latestLog}</Text>
        </View>

        {state.condition !== 'dead' && (
          <View style={styles.lengthLabelContainer} pointerEvents="none">
            <View style={styles.lengthLabelPanel}>
              <Text style={styles.lengthLabelPrefix}>体長（目安）</Text>
              <Text style={styles.lengthLabelValue}>
                {lengthCmText}
                <Text style={styles.lengthLabelUnit}> cm</Text>
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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
  lengthLabelContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    zIndex: 3,
    alignItems: 'center',
  },
  lengthLabelPanel: {
    backgroundColor: 'rgba(18, 32, 38, 0.92)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    maxWidth: '100%',
    alignItems: 'center',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(0,0,0,0.35)' as any }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.35,
          shadowRadius: 8,
          elevation: 6,
        }),
  },
  lengthLabelPrefix: {
    color: 'rgba(230, 245, 248, 0.85)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  lengthLabelValue: {
    color: '#f2fbfc',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  lengthLabelUnit: {
    color: 'rgba(230, 245, 248, 0.9)',
    fontSize: 13,
    fontWeight: '600',
  },
  riverBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    // widthとheightは動的に計算されるため、ここでは指定しない
    // 画面全体を覆うようにする
  },
  oosanContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  oosan: {
    width: 100,
    height: 80,
  },
  dailyLogContainer: {
    position: 'absolute',
    bottom: 118,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginHorizontal: 20,
  },
  dailyLog: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 16,
    textAlign: 'center',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
  },
});

export default App;
