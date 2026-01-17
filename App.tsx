import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Animated, Dimensions, Platform, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import {
  AppState,
  Condition,
  createInitialState,
  processGrowth,
  processCondition,
  generateDailyLog,
} from './src/logic';

// AsyncStorage のキー
const STORAGE_KEY = 'oosanRiverState';

// AsyncStorage から状態を読み込む
export const loadState = async (): Promise<AppState> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
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
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  // オオサンショウウオの位置アニメーション（X座標）
  const oosanXAnim = React.useRef(new Animated.Value(0)).current;
  // 水草のアニメーション用（2個）
  const swayAnim1 = React.useRef(new Animated.Value(0)).current;
  const swayAnim2 = React.useRef(new Animated.Value(0)).current;

  // 画像をプリロード
  useEffect(() => {
    const loadImages = async () => {
      try {
        if (Platform.OS !== 'web') {
          await Asset.loadAsync([
            require('./assets/river.png'),
            require('./assets/baby_oosan.png'),
            require('./assets/mizukusa.png'),
          ]);
        }
        setImagesLoaded(true);
      } catch (error) {
        console.error('Failed to load images:', error);
        setImagesLoaded(true); // エラーでも続行
      }
    };
    loadImages();
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

  // オオサンショウウオのうろうろアニメーション
  useEffect(() => {
    const moveOosan = () => {
      const { width: screenWidth } = Dimensions.get('window');
      // 画面幅の20%〜80%の範囲でランダムな位置を生成
      const minX = -screenWidth * 0.3;
      const maxX = screenWidth * 0.3;
      const targetX = minX + Math.random() * (maxX - minX);
      
      // 移動時間（2〜5秒）
      const moveDuration = 2000 + Math.random() * 3000;
      
      // 待機時間（1〜4秒、たまに長めに10〜15秒）
      const waitDuration = Math.random() < 0.2 
        ? 10000 + Math.random() * 5000  // 20%の確率で長めに止まる
        : 1000 + Math.random() * 3000;
      
      Animated.sequence([
        Animated.timing(oosanXAnim, {
          toValue: targetX,
          duration: moveDuration,
          useNativeDriver: true,
        }),
        Animated.delay(waitDuration),
      ]).start(() => {
        moveOosan(); // 次の移動を開始
      });
    };
    
    moveOosan();

    return () => {
      oosanXAnim.stopAnimation();
    };
  }, []);

  // 水草のゆらゆらアニメーション
  useEffect(() => {
    const createSwayAnimation = (animValue: Animated.Value, delay: number, duration: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animValue, {
            toValue: 1,
            duration: duration,
            useNativeDriver: true,
          }),
          Animated.timing(animValue, {
            toValue: -1,
            duration: duration,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const anim1 = createSwayAnimation(swayAnim1, 0, 2000);
    const anim2 = createSwayAnimation(swayAnim2, 500, 1800);

    anim1.start();
    anim2.start();

    return () => {
      anim1.stop();
      anim2.stop();
    };
  }, []);

  // なでる挙動（タップ）
  const handlePress = () => {
    if (!state) return;
    
    // 10% の確率でアニメーション（weak状態のときは動かない）
    if (Math.random() < 0.1 && state.condition === 'healthy') {
      setIsPetting(true);
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.05,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
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

  const size = state.sizeFactor * 100; // ベースサイズ100
  const opacity = state.condition === 'weak' ? 0.5 : 1.0;
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  
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
            source={require('./assets/river.png')}
            style={styles.riverBackground}
            resizeMode="cover"
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
              ],
              opacity: opacity,
            },
          ]}
        >
          {imagesLoaded && (
            <Image
              source={require('./assets/baby_oosan.png')}
              style={[styles.oosan, { width: size, height: size * 0.8 }]}
              resizeMode="contain"
            />
          )}
          
          {/* オオサンショウウオの周りの水草（左） */}
          <Animated.View
            style={[
              styles.mizukusaContainer,
              styles.mizukusaLeft,
              {
                transform: [
                  {
                    translateX: swayAnim1.interpolate({
                      inputRange: [-1, 1],
                      outputRange: [-10, 10],
                    }),
                  },
                  {
                    rotate: swayAnim1.interpolate({
                      inputRange: [-1, 1],
                      outputRange: ['-5deg', '5deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            {imagesLoaded && (
              <Image
                source={require('./assets/mizukusa.png')}
                style={styles.mizukusa}
                resizeMode="contain"
              />
            )}
          </Animated.View>
          
          {/* オオサンショウウオの周りの水草（右） */}
          <Animated.View
            style={[
              styles.mizukusaContainer,
              styles.mizukusaRight,
              {
                transform: [
                  {
                    translateX: swayAnim2.interpolate({
                      inputRange: [-1, 1],
                      outputRange: [-10, 10],
                    }),
                  },
                  {
                    rotate: swayAnim2.interpolate({
                      inputRange: [-1, 1],
                      outputRange: ['-5deg', '5deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            {imagesLoaded && (
              <Image
                source={require('./assets/mizukusa.png')}
                style={styles.mizukusa}
                resizeMode="contain"
              />
            )}
          </Animated.View>
        </Animated.View>
      )}
      
        {/* 日次ログ */}
        <View style={styles.dailyLogContainer}>
          <Text style={styles.dailyLog}>{state.latestLog}</Text>
        </View>
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
  },
  container: {
    flex: 1,
    width: '100%',
    minHeight: Dimensions.get('window').height,
  },
  loadingText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    marginTop: '50%',
  },
  riverBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    minHeight: Dimensions.get('window').height,
  },
  oosanContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oosan: {
    width: 100,
    height: 80,
  },
  dailyLogContainer: {
    position: 'absolute',
    bottom: 40,
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
  mizukusaContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mizukusaLeft: {
    left: -80,
    bottom: 40,
  },
  mizukusaRight: {
    right: -80,
    bottom: 40,
  },
  mizukusa: {
    width: 60,
    height: 120,
  },
});

export default App;
