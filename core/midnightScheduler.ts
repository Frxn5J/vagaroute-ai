import { reloadPool } from './pool';
import { getAppSettings } from './db';
import { logger } from '../utils/logger';

let midnightTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Calculates the next midnight in milliseconds based on the configured timezone.
 * Uses Intl.DateTimeFormat to handle timezone conversions properly.
 */
function getNextMidnightMs(timezone: string): number {
  const now = new Date();
  
  // Get current time in the target timezone
  const tzOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  };
  
  const formatter = new Intl.DateTimeFormat('en-US', tzOptions);
  const parts = formatter.formatToParts(now);
  const partValues: Record<string, number> = {};
  
  for (const part of parts) {
    if (part.type !== 'literal') {
      partValues[part.type] = Number.parseInt(part.value, 10);
    }
  }
  
  // Create next midnight in the target timezone
  const nextMidnight = new Date(Date.UTC(
    partValues.year,
    partValues.month - 1,
    partValues.day,
    0, 0, 0, 0
  ));
  
  // If it's already past midnight today, schedule for tomorrow
  if (nextMidnight.getTime() <= now.getTime()) {
    nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  }
  
  return nextMidnight.getTime();
}

/**
 * Schedules the model refresh to run at midnight in the configured timezone.
 */
export function scheduleMidnightModelRefresh(): void {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
  
  const settings = getAppSettings();
  const timezone = settings.serverTimezone || 'UTC';
  
  const msUntilMidnight = getNextMidnightMs(timezone) - Date.now();
  const delay = Math.max(msUntilMidnight, 1000); // At least 1 second
  
  const scheduledTime = new Date(Date.now() + delay);
  logger.info({
    timezone,
    scheduledTime: scheduledTime.toISOString(),
    delayMs: delay,
    delayHours: Math.round(delay / 3600000 * 100) / 100,
  }, 'Scheduled midnight model refresh');
  
  midnightTimer = setTimeout(() => {
    logger.info({ timezone }, 'Running midnight model refresh');
    
    // Refresh all provider models
    reloadPool('midnight-refresh')
      .then(() => {
        logger.info({ timezone }, 'Midnight model refresh completed successfully');
      })
      .catch((err) => {
        logger.error({ err }, 'Midnight model refresh failed');
      })
      .finally(() => {
        // Schedule the next refresh
        scheduleMidnightModelRefresh();
      });
  }, delay);
}

/**
 * Cancels the scheduled midnight refresh.
 */
export function cancelMidnightModelRefresh(): void {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
    logger.info({}, 'Cancelled midnight model refresh');
  }
}
