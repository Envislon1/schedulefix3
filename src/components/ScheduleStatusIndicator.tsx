
import React, { useEffect, useState } from 'react';
import { getTimeDifferenceText } from '@/utils/timeUtils';
import { CalendarClock, Bell } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useScheduleCountdown } from '@/hooks/useScheduleCountdown';

interface ScheduleStatusIndicatorProps {
  triggerTime: string;
  dayOfWeek: string;
  systemId?: string;
}

export const ScheduleStatusIndicator: React.FC<ScheduleStatusIndicatorProps> = ({
  triggerTime,
  dayOfWeek,
  systemId
}) => {
  // Get current day and check if the schedule is for today
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = dayNames[now.getUTCDay()];
  const isTodayScheduled = dayOfWeek === currentDay;
  
  // Use the countdown hook to get timing information and trigger state
  const { countdown, triggerState, hasTriggered } = useScheduleCountdown(triggerTime, dayOfWeek, systemId);
  
  // Parse the trigger time
  const [hours, minutes] = triggerTime.split(':').map(Number);
  
  // Calculate if the schedule is upcoming today, already passed today, or scheduled for another day
  let statusColor = 'bg-blue-100 text-blue-800';
  let statusText = 'Scheduled';
  
  if (isTodayScheduled) {
    const scheduleDate = new Date();
    scheduleDate.setUTCHours(hours, minutes, 0, 0);
    
    if (now.getTime() < scheduleDate.getTime()) {
      // Upcoming today
      statusColor = 'bg-green-100 text-green-800';
      statusText = 'Today';
    } else {
      // Already passed today
      statusColor = 'bg-gray-100 text-gray-800';
      statusText = 'Completed';
    }
  } else {
    // Find how many days until the scheduled day
    const currentDayIndex = now.getUTCDay();
    const scheduledDayIndex = dayNames.indexOf(dayOfWeek);
    let daysUntil = scheduledDayIndex - currentDayIndex;
    
    // If the day has passed this week, it will be negative, so add 7 to get days until next occurrence
    if (daysUntil <= 0) {
      daysUntil += 7;
    }
    
    if (daysUntil === 1) {
      statusColor = 'bg-yellow-100 text-yellow-800';
      statusText = 'Tomorrow';
    } else {
      statusColor = 'bg-blue-100 text-blue-800';
      statusText = `In ${daysUntil} days`;
    }
  }

  // Display countdown if available
  if (countdown && countdown !== 'Invalid time' && countdown !== 'Invalid day') {
    statusText = countdown;
  }

  // Change status color if triggered
  if (triggerState) {
    statusColor = 'bg-orange-100 text-orange-800';
    statusText = 'Triggering...';
  }

  if (hasTriggered) {
    statusColor = 'bg-green-100 text-green-800';
    statusText = 'Executed';
  }

  // Update the title bar with a notification when triggered
  useEffect(() => {
    if (triggerState && !hasTriggered) {
      // Display toast notification
      toast({
        title: "Schedule Triggered",
        description: `The schedule for ${dayOfWeek} at ${triggerTime} is running now`,
      });
      
      // Update document title temporarily
      const originalTitle = document.title;
      document.title = `🔔 Schedule Triggered - ${originalTitle}`;
      
      // Reset title after 10 seconds
      const titleTimeout = setTimeout(() => {
        document.title = originalTitle;
      }, 10000);
      
      return () => {
        clearTimeout(titleTimeout);
        document.title = originalTitle;
      };
    }
  }, [triggerState, hasTriggered, dayOfWeek, triggerTime]);

  return (
    <div className="flex items-center space-x-2">
      {triggerState && (
        <Bell className="h-4 w-4 text-orange-500 animate-pulse" />
      )}
      {!triggerState && (
        <CalendarClock className="h-4 w-4 text-orange-500" />
      )}
      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
        {statusText}
      </div>
    </div>
  );
};
