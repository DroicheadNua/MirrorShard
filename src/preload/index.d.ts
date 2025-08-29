import { IElectronAPI } from '../@types/electron'; // パスは要調整
declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}