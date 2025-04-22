
import React from 'react';
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
  const { countdown, lastCalculation, triggerState, hasTriggered } = useScheduleCountdown(triggerTime, dayOfWeek, systemId);
  
  console.log(`ScheduleStatusIndicator for ${triggerTime} on ${dayOfWeek}:`, {
    countdown,
    lastCalculation: lastCalculation ? new Date(lastCalculation).toISOString() : null,
    triggerState,
    hasTriggered,
    currentTime: new Date().toISOString()
  });
  
  // Determine status color and text
  let statusColor = 'bg-blue-100 text-blue-800'; // Default (far from trigger)
  let statusText = 'Scheduled';
  
  if (countdown === 'Triggering soon') {
    statusColor = 'bg-yellow-100 text-yellow-800';
    statusText = 'Triggering Soon';
  } else if (countdown === 'Triggering...') {
    statusColor = 'bg-green-100 text-green-800';
    statusText = 'Triggering Now';
  } else if (countdown === 'Invalid time format' || countdown === 'Invalid day format') {
    statusColor = 'bg-red-100 text-red-800';
    statusText = 'Invalid Schedule';
  }

  return (
    <div className="flex flex-col space-y-1">
      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
        {statusText}
        {hasTriggered && <span className="ml-1">(Executed)</span>}
      </div>
      <div className="text-sm text-gray-500">
        {statusText !== 'Invalid Schedule' ? (
          <span>
            Next trigger: <span className="font-medium">{dayOfWeek} at {triggerTime}</span> 
            {countdown && <span> ({countdown})</span>}
            <br />
            <span className="text-xs text-gray-400">
              Trigger state: {triggerState ? 'Active' : 'Waiting'} | 
              Last check: {lastCalculation ? new Date(lastCalculation).toLocaleTimeString() : 'None'}
            </span>
          </span>
        ) : (
          <span>
            Invalid schedule configuration
          </span>
        )}
      </div>
    </div>
  );
};
