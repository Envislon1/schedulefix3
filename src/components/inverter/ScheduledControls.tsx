
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScheduleStatusIndicator } from '../ScheduleStatusIndicator';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { ScheduleDirectExecutor } from '../ScheduleDirectExecutor';
import { runTimeAlignmentTest } from '@/utils/scheduleUtils';

interface ScheduledControlsProps {
  inverterId: string;
}

export function ScheduledControls({ inverterId }: ScheduledControlsProps) {
  const [systemId, setSystemId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  
  // Get system_id from inverter_id
  useEffect(() => {
    async function getSystemId() {
      if (!inverterId) return;
      
      const { data, error } = await supabase
        .from('inverter_systems')
        .select('system_id')
        .eq('id', inverterId)
        .single();
        
      if (error) {
        console.error('Error getting system ID:', error);
      } else if (data) {
        setSystemId(data.system_id);
      }
    }
    
    getSystemId();
  }, [inverterId]);
  
  // Get schedules for this system
  const { data: schedules, isLoading, error } = useQuery({
    queryKey: ['schedules', systemId],
    queryFn: async () => {
      if (!systemId) return [];
      
      const { data, error } = await supabase
        .from('inverter_schedules')
        .select('*')
        .eq('system_id', systemId)
        .eq('is_active', true);
        
      if (error) throw error;
      return data || [];
    },
    enabled: !!systemId,
  });
  
  // Function to check server time
  const handleCheckServerTime = async () => {
    if (!systemId) return;
    
    try {
      toast({
        title: "Running Diagnostics",
        description: "Checking server time alignment...",
      });
      
      const result = await runTimeAlignmentTest(systemId);
      
      toast({
        title: "Diagnostics Complete",
        description: `Server time: ${new Date(result.server.server_time).toLocaleTimeString()}, Local time: ${new Date(result.local.local_time).toLocaleTimeString()}`,
      });
      
      setShowDiagnostics(true);
    } catch (error) {
      toast({
        title: "Diagnostics Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  };
  
  if (!systemId) {
    return <div className="text-gray-500">System ID not available</div>;
  }
  
  if (isLoading) {
    return <div className="text-gray-500">Loading schedules...</div>;
  }
  
  if (error) {
    return <div className="text-red-500">Error: {error instanceof Error ? error.message : "Unknown error"}</div>;
  }
  
  if (!schedules || schedules.length === 0) {
    return (
      <div className="text-gray-500">
        No active schedules found for this system.
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleCheckServerTime}
          className="mt-4 border-orange-500/40 text-orange-500 hover:bg-orange-500/20"
        >
          Run System Diagnostics
        </Button>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {schedules.map((schedule) => (
          <div 
            key={schedule.id} 
            className="p-4 bg-black/20 border border-orange-500/20 rounded-lg"
          >
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
              <div>
                <h3 className="text-lg font-semibold">
                  {schedule.name || `Power ${schedule.state ? 'ON' : 'OFF'} Schedule`}
                </h3>
                <p className="text-sm text-gray-400">
                  {schedule.days_of_week.join(', ')} at {schedule.trigger_time}
                </p>
              </div>
              
              <ScheduleStatusIndicator 
                triggerTime={schedule.trigger_time} 
                dayOfWeek={schedule.days_of_week[0]} 
                systemId={systemId}
              />
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-6">
        <ScheduleDirectExecutor systemId={systemId} />
      </div>
      
      <div className="flex justify-end mt-4">
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleCheckServerTime}
          className="border-orange-500/40 text-orange-500 hover:bg-orange-500/20"
        >
          Run System Diagnostics
        </Button>
      </div>
      
      {showDiagnostics && (
        <div className="mt-4 p-4 bg-black/20 border border-orange-500/20 rounded-lg text-sm">
          <h4 className="font-medium mb-2">System Information</h4>
          <p>System ID: {systemId}</p>
          <p>Browser Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
          <p>Local Time: {new Date().toLocaleTimeString()}</p>
          <p>UTC Time: {new Date().toUTCString()}</p>
        </div>
      )}
    </div>
  );
}
