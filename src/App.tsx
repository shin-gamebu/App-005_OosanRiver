import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Image, TouchableOpacity, Animated, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppState,
  Condition,
  createInitialState,
  processGrowth,
  processCondition,
  generateDailyLog,
} from './logic';

// 型を再エクスポート（後方互換性のため）
export type { Condition, AppState };

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
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

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
  const rock1Left = screenWidth * 0.1;
  const rock1Bottom = screenHeight * 0.2;
  const rock2Right = screenWidth * 0.2;
  const rock2Bottom = screenHeight * 0.15;
  const rock3Left = screenWidth * 0.6;
  const rock3Bottom = screenHeight * 0.25;

  return (
    <TouchableOpacity 
      style={styles.container} 
      onPress={handlePress}
      activeOpacity={1}
    >
      {/* 川の背景 */}
      <View style={styles.riverBackground} />
      
      {/* 岩 */}
      <View style={[styles.rock, styles.rock1, { left: rock1Left, bottom: rock1Bottom }]} />
      <View style={[styles.rock, styles.rock2, { right: rock2Right, bottom: rock2Bottom }]} />
      <View style={[styles.rock, styles.rock3, { left: rock3Left, bottom: rock3Bottom }]} />
      
      {/* 水草 */}
      <View style={[styles.weed, styles.weed1]} />
      <View style={[styles.weed, styles.weed2]} />
      <View style={[styles.weed, styles.weed3]} />
      
      {/* オオサンショウウオ */}
      {state.condition !== 'dead' && (
        <Animated.View
          style={[
            styles.oosanContainer,
            {
              bottom: oosanBottom,
              transform: [{ scale: scaleAnim }],
              opacity: opacity,
            },
          ]}
        >
          <Image
            source={require('../assets/baby_oosan.png')}
            style={[styles.oosan, { width: size, height: size * 0.8 }]}
            resizeMode="contain"
          />
        </Animated.View>
      )}
      
      {/* 日次ログ */}
      <View style={styles.dailyLogContainer}>
        <Text style={styles.dailyLog}>{state.latestLog}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
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
    backgroundColor: '#4a90a4',
  },
  rock: {
    position: 'absolute',
    backgroundColor: '#6b5b4f',
    borderRadius: 50,
    opacity: 0.7,
  },
  rock1: {
    width: 120,
    height: 80,
    transform: [{ rotate: '-15deg' }],
  },
  rock2: {
    width: 90,
    height: 60,
    transform: [{ rotate: '20deg' }],
  },
  rock3: {
    width: 70,
    height: 50,
    transform: [{ rotate: '-10deg' }],
  },
  weed: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: '#2d5a3d',
    borderRadius: 2,
    opacity: 0.6,
  },
  weed1: {
    width: 8,
    height: 150,
    left: '25%',
    bottom: 0,
  },
  weed2: {
    width: 6,
    height: 120,
    left: '50%',
    bottom: 0,
  },
  weed3: {
    width: 7,
    height: 100,
    right: '30%',
    bottom: 0,
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
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});

export default App;
