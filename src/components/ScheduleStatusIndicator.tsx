
import React from 'react';
import { getTimeDifferenceText } from '@/utils/timeUtils';

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
  // Simple display of schedule info without complex countdown logic
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = dayNames[now.getUTCDay()];
  const isTodayScheduled = dayOfWeek === currentDay;
  
  // Simple badge coloring based on whether it's scheduled for today
  let statusColor = isTodayScheduled ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
  let statusText = isTodayScheduled ? 'Today' : 'Scheduled';

  return (
    <div className="flex flex-col space-y-1">
      <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
        {statusText}
      </div>
      <div className="text-sm text-gray-500">
        <span>
          Schedule: <span className="font-medium">{dayOfWeek} at {triggerTime}</span>
        </span>
      </div>
    </div>
  );
};
