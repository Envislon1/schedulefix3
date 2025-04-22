
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { forceExecuteSchedule } from '@/utils/scheduleUtils';
import { toast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Bell } from 'lucide-react';

interface ScheduleDirectExecutorProps {
  systemId: string;
}

export const ScheduleDirectExecutor: React.FC<ScheduleDirectExecutorProps> = ({ systemId }) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executingScheduleId, setExecutingScheduleId] = useState<string | null>(null);
  
  // Fetch all active schedules for this system
  const { data: schedules, isLoading, error, refetch } = useQuery({
    queryKey: ['active-schedules', systemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inverter_schedules')
        .select('*')
        .eq('system_id', systemId)
        .eq('is_active', true)
        .order('trigger_time');
        
      if (error) throw error;
      return data || [];
    },
    enabled: !!systemId,
  });
  
  const handleExecuteSchedule = async (scheduleId: string) => {
    try {
      setIsExecuting(true);
      setExecutingScheduleId(scheduleId);
      
      // Show toast to indicate execution is starting
      toast({
        title: "Executing Schedule",
        description: "Running the scheduled action now...",
      });
      
      // Flash the title bar to get attention
      const originalTitle = document.title;
      document.title = "⚡ Executing Power Schedule...";
      
      const result = await forceExecuteSchedule(scheduleId, systemId);
      
      // Show success toast
      toast({
        title: "Schedule Executed",
        description: `Power has been turned ${result.schedule.state ? 'ON' : 'OFF'} successfully.`,
      });
      
      // Update title to show completion for a few seconds
      document.title = `✅ Power ${result.schedule.state ? 'ON' : 'OFF'} - ${originalTitle}`;
      setTimeout(() => {
        document.title = originalTitle;
      }, 5000);
      
      // Refresh the schedules list after execution
      refetch();
    } catch (error) {
      // Show error toast
      toast({
        title: "Execution Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
      console.error("Failed to execute schedule:", error);
      
      // Update title to show error
      document.title = "❌ Schedule Error";
      setTimeout(() => {
        document.title = document.title.replace("❌ Schedule Error", "");
      }, 5000);
    } finally {
      setIsExecuting(false);
      setExecutingScheduleId(null);
    }
  };
  
  if (isLoading) {
    return <div className="p-4 text-center">Loading schedules...</div>;
  }
  
  if (error) {
    return (
      <div className="p-4 text-center text-red-500">
        Error loading schedules: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }
  
  if (!schedules || schedules.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No active schedules found for this system.
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Active Schedules</h3>
      <p className="text-sm text-gray-500">
        Use the buttons below to execute schedules immediately without waiting for their scheduled time.
      </p>
      
      <div className="grid gap-2">
        {schedules.map((schedule) => (
          <div key={schedule.id} className="flex items-center justify-between p-3 bg-black/30 border border-orange-500/20 rounded-md">
            <div>
              <p className="font-medium">
                {schedule.days_of_week.join(', ')} at {schedule.trigger_time}
              </p>
              <p className="text-sm text-gray-400">
                Action: Turn power {schedule.state ? 'ON' : 'OFF'}
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              disabled={isExecuting}
              onClick={() => handleExecuteSchedule(schedule.id)}
              className={`border-orange-500/40 text-orange-500 hover:bg-orange-500/20 ${
                executingScheduleId === schedule.id ? 'animate-pulse bg-orange-500/10' : ''
              }`}
            >
              {isExecuting && executingScheduleId === schedule.id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Bell className="mr-2 h-4 w-4" />
                  Execute Now
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
