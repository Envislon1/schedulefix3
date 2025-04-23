
import { useState, useEffect, useRef } from 'react';
import { manuallyTriggerScheduleCheck } from '../utils/scheduleUtils';
import { toast as shadcnToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { getTimeDifferenceText } from '@/utils/timeUtils';

// Debug function that guarantees toast visibility in console
function debugToast(type: string, title: string, message: string) {
  const timestamp = new Date().toISOString();
  console.log(`=== TOAST NOTIFICATION (${type}) at ${timestamp} ===`);
  console.log(`Title: ${title}`);
  console.log(`Message: ${message}`);
  console.log('===================================');
  
  // Try both toast systems to ensure at least one works
  try {
    sonnerToast[type === 'SUCCESS' ? 'success' : type === 'ERROR' ? 'error' : type === 'LOADING' ? 'loading' : 'info'](
      title,
      { description: message, duration: 5000 }
    );
  } catch (e) {
    console.error(`Failed to show Sonner toast: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  try {
    shadcnToast({
      title: title,
      description: message,
      variant: type === 'ERROR' ? 'destructive' : 'default',
    });
  } catch (e) {
    console.error(`Failed to show Shadcn toast: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface CountdownState {
  countdown: string;
  lastCalculation: number;
  triggerState: boolean;
  hasTriggered: boolean;
}

// This hook calculates a countdown to a scheduled event
export const useScheduleCountdown = (triggerTime: string, dayOfWeek: string, systemId?: string): CountdownState => {
  const [countdownState, setCountdownState] = useState<CountdownState>({
    countdown: '',
    lastCalculation: 0,
    triggerState: false,
    hasTriggered: false
  });
  const lastCalculationRef = useRef<number>(0);
  const triggerRef = useRef<boolean>(false);
  const hasTriggeredRef = useRef<boolean>(false);
  const triggeringSoonNotifiedRef = useRef<boolean>(false);
  const hookInitializedRef = useRef<boolean>(false);
  const consoleLogCountRef = useRef<number>(0);

  // Enhanced logging function that throttles logs but ensures critical ones are shown
  const logDebug = (message: string, data: any = {}, force: boolean = false) => {
    consoleLogCountRef.current += 1;
    const shouldLog = force || consoleLogCountRef.current % 10 === 0;
    
    if (shouldLog || data.critical) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] SCHEDULE DEBUG - ${message}`, {
        triggerTime,
        dayOfWeek,
        systemId,
        ...data,
        hasTriggered: hasTriggeredRef.current,
        triggerState: triggerRef.current,
        consoleLogCount: consoleLogCountRef.current
      });
    }
    
    if (data.critical) {
      console.trace(`Critical schedule event trace for ${triggerTime} on ${dayOfWeek}`);
    }
  };

  useEffect(() => {
    console.log(`useScheduleCountdown initialized for ${triggerTime} on ${dayOfWeek}${systemId ? ` (System ID: ${systemId})` : ''}`);
    console.trace(`useScheduleCountdown hook initialization trace`);
    
    // Reset internal state on prop changes
    triggerRef.current = false;
    hasTriggeredRef.current = false;
    triggeringSoonNotifiedRef.current = false;
    lastCalculationRef.current = 0;
    
    const calculateTimeRemaining = () => {
      const now = new Date();
      lastCalculationRef.current = now.getTime();
      
      // Parse the trigger time correctly
      const [hours, minutes] = triggerTime.split(':').map(Number);
      
      if (isNaN(hours) || isNaN(minutes)) {
        logDebug(`Invalid trigger time format: "${triggerTime}"`, { critical: true });
        return 'Invalid time format';
      }
      
      // Create target date with proper UTC handling
      const targetDate = new Date();
      targetDate.setUTCHours(hours, minutes, 0, 0);
      
      // Calculate days until next occurrence based on day of week
      const currentDay = now.getUTCDay();
      const dayMap: Record<string, number> = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
      };
      const targetDay = dayMap[dayOfWeek];
      
      if (targetDay === undefined) {
        logDebug(`Invalid day of week: "${dayOfWeek}"`, { critical: true });
        return 'Invalid day format';
      }
      
      // If the target time has passed today, move to next occurrence
      if (targetDate.getTime() < now.getTime()) {
        targetDate.setUTCDate(targetDate.getUTCDate() + 1);
      }
      
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && targetDate.getTime() < now.getTime()) daysUntil = 7;
      
      targetDate.setUTCDate(targetDate.getUTCDate() + daysUntil);
      
      // Calculate difference
      let timeDiff = targetDate.getTime() - now.getTime();
      
      // Detailed logging for debugging
      logDebug(`Schedule calculation:`, {
        now: now.toISOString(),
        targetDate: targetDate.toISOString(),
        currentDay,
        targetDay,
        daysUntil,
        diffMs: timeDiff,
        diffSeconds: Math.floor(timeDiff / 1000),
        force: true
      });
      
      // MODIFIED: Set trigger state when we're within 60 seconds of the target time
      if (timeDiff <= 60000 && timeDiff > -60000) { // Within 60 seconds before or after
        if (!triggerRef.current) {
          triggerRef.current = true;
          logDebug(`TRIGGER STATE ACTIVATED - Within 60 second window of ${triggerTime} on ${dayOfWeek}`, { critical: true });
          
          // Use both toast systems and debug console
          debugToast('SUCCESS', 'Schedule Triggered', `Trigger time reached for ${dayOfWeek} at ${triggerTime}`);
          
          // Execute auto-trigger if conditions are met and we haven't triggered yet
          if (systemId && !hasTriggeredRef.current) {
            logDebug(`Auto-triggering execution within 60 second window`, { critical: true });
            executeAutoTrigger();
          }
        }
        return 'Triggering...';
      }
      
      // Reset trigger state if we're outside the 60-second window
      if (triggerRef.current && (timeDiff > 60000 || timeDiff < -60000)) {
        logDebug(`Resetting trigger state - Outside 60 second window`, { force: true });
        triggerRef.current = false;
      }
      
      // Convert to days, hours, minutes
      const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      timeDiff -= days * (1000 * 60 * 60 * 24);
      
      const hrs = Math.floor(timeDiff / (1000 * 60 * 60));
      timeDiff -= hrs * (1000 * 60 * 60);
      
      const mins = Math.floor(timeDiff / (1000 * 60));
      
      if (days > 0) {
        return `in ${days}d ${hrs}h ${mins}m`;
      } else if (hrs > 0) {
        return `in ${hrs}h ${mins}m`;
      } else if (mins > 0) {
        return `in ${mins}m`;
      } else {
        return 'Triggering soon';
      }
    };

    // Function to execute the auto trigger by calling the schedule runner
    const executeAutoTrigger = async () => {
      if (!systemId || hasTriggeredRef.current) {
        logDebug(`Auto-trigger prevented - ${!systemId ? 'No systemId' : 'Already triggered'}`, { force: true });
        return;
      }
      
      logDebug(`AUTO-TRIGGER ATTEMPT for ${triggerTime} on ${dayOfWeek}`, { 
        critical: true,
        triggerState: triggerRef.current,
        currentState: countdownState.countdown,
        systemId
      });
      
      // Show toast notification when triggering
      debugToast('LOADING', 'Schedule Triggered', `Executing scheduled action for ${dayOfWeek} at ${triggerTime}`);
      
      try {
        hasTriggeredRef.current = true; // Mark as triggered to prevent duplicate calls
        setCountdownState(prev => ({ ...prev, hasTriggered: true }));
        
        logDebug(`Calling manuallyTriggerScheduleCheck with execute=true`, { critical: true });
        
        // Call the manual trigger function with execute flag set to true
        const result = await manuallyTriggerScheduleCheck(
          systemId,
          triggerTime,
          dayOfWeek,
          true // Execute the schedule
        );
        
        logDebug(`Auto-trigger executed successfully:`, { 
          critical: true,
          result
        });
        
        // Show success toast notification
        debugToast('SUCCESS', 'Schedule Executed', `The scheduled action for ${dayOfWeek} at ${triggerTime} completed`);
        
        // Reset the triggered flag after 5 minutes to allow future triggers
        setTimeout(() => {
          logDebug(`Resetting hasTriggered flag after timeout period`, { force: true });
          hasTriggeredRef.current = false;
          setCountdownState(prev => ({ ...prev, hasTriggered: false }));
        }, 5 * 60 * 1000);
      } catch (error) {
        logDebug(`Failed to execute auto-trigger:`, { 
          critical: true,
          error: error instanceof Error ? error.message : String(error)
        });
        
        // Show error toast notification
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        debugToast('ERROR', 'Schedule Error', `Failed to execute the scheduled action: ${errorMessage}`);
        
        // Reset the triggered flag after failure (with a shorter timeout)
        setTimeout(() => {
          logDebug(`Resetting hasTriggered flag after error`, { force: true });
          hasTriggeredRef.current = false;
          setCountdownState(prev => ({ ...prev, hasTriggered: false }));
        }, 60 * 1000);
      }
    };

    // Initial calculation
    if (!hookInitializedRef.current) {
      hookInitializedRef.current = true;
      
      const initialCountdown = calculateTimeRemaining();
      setCountdownState({
        countdown: initialCountdown,
        lastCalculation: lastCalculationRef.current,
        triggerState: triggerRef.current,
        hasTriggered: hasTriggeredRef.current
      });
      
      // Show startup toast message to confirm the hook is working
      debugToast('INFO', 'Schedule monitoring started', `Monitoring ${triggerTime} on ${dayOfWeek}`);
      
      logDebug(`Initial calculation complete`, { 
        countdown: initialCountdown,
        force: true
      });
    }
    
    // Update more frequently as we get closer to the trigger time
    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining();
      
      setCountdownState({
        countdown: remaining,
        lastCalculation: lastCalculationRef.current,
        triggerState: triggerRef.current,
        hasTriggered: hasTriggeredRef.current
      });
      
      // If we're close to triggering, update more frequently
      if (remaining === 'Triggering soon' || remaining === 'Triggering...') {
        logDebug(`Setting up quick interval for imminent trigger`, { 
          countdown: remaining,
          force: true 
        });
        
        clearInterval(interval);
        const quickInterval = setInterval(() => {
          const nowState = calculateTimeRemaining();
          
          setCountdownState({
            countdown: nowState,
            lastCalculation: lastCalculationRef.current,
            triggerState: triggerRef.current,
            hasTriggered: hasTriggeredRef.current
          });
          
          logDebug(`Quick interval update`, { countdown: nowState });
        }, 1000); // Check every second when close to trigger time
        
        // Clean up the quick interval after 2 minutes
        setTimeout(() => {
          clearInterval(quickInterval);
          logDebug(`Cleared quick interval after timeout`, { force: true });
        }, 120000);
      }
    }, 10000); // Update every 10 seconds normally
    
    return () => clearInterval(interval);
  }, [triggerTime, dayOfWeek, systemId, countdownState.countdown]);

  return countdownState;
};

// This function calculates the countdown without using hooks
// It can be safely used in loops or array iterations
export const calculateCountdown = (triggerTime: string, dayOfWeek: string): string => {
  const now = new Date();
  
  // Parse the trigger time correctly
  const [hours, minutes] = triggerTime.split(':').map(Number);
  
  if (isNaN(hours) || isNaN(minutes)) {
    return 'Invalid time';
  }
  
  // Create target date with proper UTC handling
  const targetDate = new Date();
  targetDate.setUTCHours(hours, minutes, 0, 0);
  
  // If the target time has passed today, move to next occurrence
  if (targetDate.getTime() < now.getTime()) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
  }
  
  // Calculate days until next occurrence based on day of week
  const currentDay = now.getUTCDay();
  const dayMap: Record<string, number> = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };
  const targetDay = dayMap[dayOfWeek];
  
  if (targetDay === undefined) {
    return 'Invalid day';
  }
  
  let daysUntil = targetDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0 && targetDate.getTime() < now.getTime()) daysUntil = 7;
  
  targetDate.setUTCDate(targetDate.getUTCDate() + daysUntil);
  
  // Calculate difference
  let diff = targetDate.getTime() - now.getTime();
  
  if (diff <= 0) {
    return 'Triggering...';
  }
  
  if (diff < 60000) { // Less than a minute
    return 'Triggering soon';
  }
  
  // Convert to days, hours, minutes
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  diff -= days * (1000 * 60 * 60 * 24);
  
  const hrs = Math.floor(diff / (1000 * 60 * 60));
  diff -= hrs * (1000 * 60 * 60);
  
  const mins = Math.floor(diff / (1000 * 60));
  
  if (days > 0) {
    return `in ${days}d ${hrs}h ${mins}m`;
  } else if (hrs > 0) {
    return `in ${hrs}h ${mins}m`;
  } else if (mins > 0) {
    return `in ${mins}m`;
  } else {
    return 'Triggering soon';
  }
};
