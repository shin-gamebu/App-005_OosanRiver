/**
 * Jest・IDE からの import 用。実体はリポジトリ直下の App.tsx。
 */
export { default, loadState, saveState } from '../App';
export {
  createInitialState,
  getDaysDiff,
  processGrowth,
  processCondition,
  generateDailyLog,
  pickHealthyDailyLogMessage,
} from './logic';
export type { AppState, Condition } from './logic';
