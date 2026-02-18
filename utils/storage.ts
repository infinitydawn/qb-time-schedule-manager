'use client';

import { DailySchedule } from '@/types/schedule';

export interface StorageData {
  schedules: DailySchedule[];
  lastUpdated: string;
  version: string;
}

class ScheduleStorage {
  private readonly STORAGE_KEY = 'work-schedules-v1';
  private readonly VERSION = '1.0.0';

  /**
   * Load schedules from localStorage
   */
  loadSchedules(): DailySchedule[] {
    try {
      if (typeof window === 'undefined') return [];
      
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return [];

      const data: StorageData = JSON.parse(stored);
      
      // Validate data structure
      if (!data.schedules || !Array.isArray(data.schedules)) {
        console.warn('Invalid schedule data structure, starting fresh');
        return [];
      }

      return data.schedules;
    } catch (error) {
      console.error('Failed to load schedules from localStorage:', error);
      return [];
    }
  }

  /**
   * Save schedules to localStorage
   */
  saveSchedules(schedules: DailySchedule[]): boolean {
    try {
      if (typeof window === 'undefined') return false;

      const data: StorageData = {
        schedules,
        lastUpdated: new Date().toISOString(),
        version: this.VERSION
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Failed to save schedules to localStorage:', error);
      return false;
    }
  }

  /**
   * Export schedules as JSON file
   */
  exportSchedules(schedules: DailySchedule[]): void {
    try {
      const data: StorageData = {
        schedules,
        lastUpdated: new Date().toISOString(),
        version: this.VERSION
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `work-schedules-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export schedules:', error);
      throw new Error('Export failed');
    }
  }

  /**
   * Import schedules from JSON file
   */
  importSchedules(file: File): Promise<DailySchedule[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const data = JSON.parse(content);

          // Validate imported data
          if (!data.schedules || !Array.isArray(data.schedules)) {
            reject(new Error('Invalid file format: missing schedules array'));
            return;
          }

          // Basic validation of schedule structure
          for (const schedule of data.schedules) {
            if (!schedule.id || !schedule.date || !schedule.dayName || !schedule.projectManagers) {
              reject(new Error('Invalid schedule data structure'));
              return;
            }
          }

          resolve(data.schedules);
        } catch (error) {
          reject(new Error('Failed to parse JSON file'));
        }
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsText(file);
    });
  }

  /**
   * Clear all stored schedules
   */
  clearSchedules(): boolean {
    try {
      if (typeof window === 'undefined') return false;
      
      localStorage.removeItem(this.STORAGE_KEY);
      return true;
    } catch (error) {
      console.error('Failed to clear schedules:', error);
      return false;
    }
  }

  /**
   * Get storage usage info
   */
  getStorageInfo(): { used: number; available: number; percentage: number } {
    try {
      if (typeof window === 'undefined') {
        return { used: 0, available: 0, percentage: 0 };
      }

      const stored = localStorage.getItem(this.STORAGE_KEY);
      const used = stored ? new Blob([stored]).size : 0;
      
      // Rough estimation of localStorage limit (usually 5-10MB)
      const estimated_limit = 5 * 1024 * 1024; // 5MB
      const available = estimated_limit - used;
      const percentage = (used / estimated_limit) * 100;

      return { used, available, percentage };
    } catch (error) {
      console.error('Failed to get storage info:', error);
      return { used: 0, available: 0, percentage: 0 };
    }
  }

  /**
   * Create a backup of schedules
   */
  createBackup(schedules: DailySchedule[]): string {
    const data: StorageData = {
      schedules,
      lastUpdated: new Date().toISOString(),
      version: this.VERSION
    };

    return JSON.stringify(data);
  }

  /**
   * Restore from backup string
   */
  restoreFromBackup(backupString: string): DailySchedule[] {
    try {
      const data: StorageData = JSON.parse(backupString);
      
      if (!data.schedules || !Array.isArray(data.schedules)) {
        throw new Error('Invalid backup format');
      }

      return data.schedules;
    } catch (error) {
      console.error('Failed to restore from backup:', error);
      throw new Error('Invalid backup data');
    }
  }
}

// Export singleton instance
export const scheduleStorage = new ScheduleStorage();

// Hook for React components
export const useScheduleStorage = () => {
  return {
    loadSchedules: () => scheduleStorage.loadSchedules(),
    saveSchedules: (schedules: DailySchedule[]) => scheduleStorage.saveSchedules(schedules),
    exportSchedules: (schedules: DailySchedule[]) => scheduleStorage.exportSchedules(schedules),
    importSchedules: (file: File) => scheduleStorage.importSchedules(file),
    clearSchedules: () => scheduleStorage.clearSchedules(),
    getStorageInfo: () => scheduleStorage.getStorageInfo(),
    createBackup: (schedules: DailySchedule[]) => scheduleStorage.createBackup(schedules),
    restoreFromBackup: (backup: string) => scheduleStorage.restoreFromBackup(backup)
  };
};