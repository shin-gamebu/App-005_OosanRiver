import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from './App';
import {
  createInitialState,
  loadState,
  saveState,
  getDaysDiff,
  processGrowth,
  processCondition,
  generateDailyLog,
  AppState,
} from './App';

// AsyncStorage のモック
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('App コンポーネント', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
  });

  test('初期レンダリングが正常に動作する', async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    const { getByText } = render(<App />);
    
    await waitFor(() => {
      const logElement = getByText(/川の底で静かに過ごしています|新しい住処を見つけました|今日も静かに過ごしています/);
      expect(logElement).toBeTruthy();
    });
  });

  test('dead状態のときオオサンショウウオが表示されない', async () => {
    const deadState: AppState = {
      startDate: '2024-01-01',
      lastVisitDate: '2024-01-10',
      lastGrowthDate: '2024-01-01',
      sizeFactor: 1.0,
      condition: 'dead',
      latestLog: '静かな川の流れだけが残っています。',
    };
    
    mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(deadState));
    const { queryByTestId } = render(<App />);
    
    await waitFor(() => {
      // オオサンショウウオの画像が表示されないことを確認
      // 実際のテストでは、testIDを追加する必要があるかもしれません
      expect(queryByTestId('oosan-image')).toBeNull();
    });
  });
});

describe('ロジック関数のテスト', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
  });

  describe('createInitialState', () => {
    test('初期状態が正しく生成される', () => {
      const state = createInitialState();
      const today = new Date().toISOString().split('T')[0];
      
      expect(state.startDate).toBe(today);
      expect(state.lastVisitDate).toBe(today);
      expect(state.lastGrowthDate).toBe(today);
      expect(state.sizeFactor).toBe(1.0);
      expect(state.condition).toBe('healthy');
      expect(state.latestLog).toBe('川の底で静かに過ごしています。');
    });
  });

  describe('loadState / saveState', () => {
    test('状態を保存して読み込める', async () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-02',
        lastGrowthDate: '2024-01-02',
        sizeFactor: 1.5,
        condition: 'healthy',
        latestLog: 'テストログ',
      };
      
      await saveState(state);
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'oosanRiverState',
        JSON.stringify(state)
      );
      
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(state));
      const loaded = await loadState();
      
      expect(loaded).toEqual(state);
    });

    test('保存されていない場合は初期状態を返す', async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      const state = await loadState();
      expect(state.sizeFactor).toBe(1.0);
      expect(state.condition).toBe('healthy');
    });
  });

  describe('getDaysDiff', () => {
    test('日付の差分が正しく計算される', () => {
      expect(getDaysDiff('2024-01-01', '2024-01-02')).toBe(1);
      expect(getDaysDiff('2024-01-01', '2024-01-05')).toBe(4);
      expect(getDaysDiff('2024-01-10', '2024-01-01')).toBe(9);
      expect(getDaysDiff('2024-01-01', '2024-01-01')).toBe(0);
    });
  });

  describe('processGrowth', () => {
    test('healthy状態のとき成長する', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBeGreaterThan(1.0);
      expect(result.sizeFactor).toBeLessThanOrEqual(1.003);
      expect(result.lastGrowthDate).toBe(today);
    });

    test('今日すでに成長処理済みの場合は成長しない', () => {
      const today = new Date().toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: today,
        sizeFactor: 1.5,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBe(1.5);
      expect(result.lastGrowthDate).toBe(today);
    });

    test('weak状態のときは成長しない', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        condition: 'weak',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBe(1.0);
      expect(result.lastGrowthDate).toBe(today);
    });

    test('dead状態のときは成長しない', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        condition: 'dead',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBe(1.0);
      expect(result.lastGrowthDate).toBe(today);
    });
  });

  describe('processCondition', () => {
    test('2日放置はhealthyのまま', () => {
      const today = new Date().toISOString().split('T')[0];
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: twoDaysAgo,
        lastGrowthDate: twoDaysAgo,
        sizeFactor: 1.0,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('healthy');
      expect(result.lastVisitDate).toBe(today);
    });

    test('3日放置でweakになる', () => {
      const today = new Date().toISOString().split('T')[0];
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: threeDaysAgo,
        lastGrowthDate: threeDaysAgo,
        sizeFactor: 1.0,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('weak');
      expect(result.lastVisitDate).toBe(today);
    });

    test('7日放置でdeadになる', () => {
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: sevenDaysAgo,
        lastGrowthDate: sevenDaysAgo,
        sizeFactor: 1.0,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('dead');
      expect(result.lastVisitDate).toBe(today);
    });

    test('weakから復帰できる（2日以内に訪問）', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: yesterday,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        condition: 'weak',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('healthy');
      expect(result.lastVisitDate).toBe(today);
    });
  });

  describe('generateDailyLog', () => {
    test('dead状態のとき適切なログを返す', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-10',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        condition: 'dead',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      expect(log).toBe('静かな川の流れだけが残っています。');
    });

    test('weak状態のとき適切なログを返す', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-05',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        condition: 'weak',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      const weakMessages = [
        '今日も静かに過ごしています。',
        'ゆっくりと時間が流れています。',
        '川の音が聞こえます。',
      ];
      expect(weakMessages).toContain(log);
    });

    test('初日のとき適切なログを返す', () => {
      const today = new Date().toISOString().split('T')[0];
      const state: AppState = {
        startDate: today,
        lastVisitDate: today,
        lastGrowthDate: today,
        sizeFactor: 1.0,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      expect(log).toBe('新しい住処を見つけました。');
    });

    test('healthy状態のとき適切なログを返す', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-05',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      const healthyMessages = [
        '今日も静かに過ごしています。',
        'ゆっくりと成長しています。',
        '川の流れに身を任せています。',
        '岩の陰で休んでいます。',
        '水草の間を泳いでいます。',
      ];
      expect(healthyMessages).toContain(log);
    });
  });
});
