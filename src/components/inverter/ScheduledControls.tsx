
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ScheduleStatusIndicator } from '../ScheduleStatusIndicator';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { ScheduleDirectExecutor } from '../ScheduleDirectExecutor';
import { runTimeAlignmentTest } from '@/utils/scheduleUtils';
import { PlusCircle, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

interface ScheduledControlsProps {
  inverterId: string;
}

export function ScheduledControls({ inverterId }: ScheduledControlsProps) {
  const [systemId, setSystemId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // Form state
  const [scheduleTime, setScheduleTime] = useState('');
  const [powerState, setPowerState] = useState(true);
  const [selectedDays, setSelectedDays] = useState<Record<string, boolean>>({
    Monday: false,
    Tuesday: false,
    Wednesday: false,
    Thursday: false,
    Friday: false,
    Saturday: false,
    Sunday: false
  });
  
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
  const { data: schedules, isLoading, error, refetch } = useQuery({
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
  
  // Create a new schedule
  const handleCreateSchedule = async () => {
    if (!systemId || !scheduleTime) {
      toast({
        title: "Invalid Schedule",
        description: "Please enter a valid time and select at least one day",
        variant: "destructive",
      });
      return;
    }
    
    // Validate time format (HH:MM)
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(scheduleTime)) {
      toast({
        title: "Invalid Time Format",
        description: "Please use 24-hour format (HH:MM)",
        variant: "destructive",
      });
      return;
    }
    
    // Convert selectedDays object to array of day names
    const days = Object.entries(selectedDays)
      .filter(([_, selected]) => selected)
      .map(([day]) => day);
      
    if (days.length === 0) {
      toast({
        title: "No Days Selected",
        description: "Please select at least one day of the week",
        variant: "destructive",
      });
      return;
    }
    
    setIsCreating(true);
    
    try {
      const { data, error } = await supabase
        .from('inverter_schedules')
        .insert({
          system_id: systemId,
          trigger_time: scheduleTime,
          days_of_week: days,
          state: powerState,
          is_active: true
        })
        .select()
        .single();
        
      if (error) throw error;
      
      toast({
        title: "Schedule Created",
        description: `New schedule created for ${days.join(', ')} at ${scheduleTime}`,
      });
      
      // Reset form and hide it
      setScheduleTime('');
      setPowerState(true);
      setSelectedDays({
        Monday: false,
        Tuesday: false,
        Wednesday: false,
        Thursday: false,
        Friday: false,
        Saturday: false,
        Sunday: false
      });
      setShowCreateForm(false);
      
      // Refresh the schedules list
      refetch();
    } catch (error) {
      toast({
        title: "Failed to Create Schedule",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };
  
  // Delete a schedule
  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    
    try {
      const { error } = await supabase
        .from('inverter_schedules')
        .update({ is_active: false })
        .eq('id', scheduleId);
        
      if (error) throw error;
      
      toast({
        title: "Schedule Deleted",
        description: "The schedule has been removed",
      });
      
      // Refresh the schedules list
      refetch();
    } catch (error) {
      toast({
        title: "Failed to Delete Schedule",
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
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Power Schedules</h2>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="border-orange-500/40 text-orange-500 hover:bg-orange-500/20"
        >
          <PlusCircle className="h-4 w-4 mr-2" />
          {showCreateForm ? "Cancel" : "New Schedule"}
        </Button>
      </div>
      
      {showCreateForm && (
        <div className="p-4 bg-black/30 border border-orange-500/20 rounded-lg space-y-4">
          <h3 className="text-lg font-medium">Create New Schedule</h3>
          
          <div className="space-y-2">
            <label htmlFor="scheduleTime" className="text-sm font-medium">Time (24-hour format)</label>
            <Input
              id="scheduleTime"
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="bg-black/20 border-orange-500/30"
            />
          </div>
          
          <div className="space-y-2">
            <span className="text-sm font-medium">Days of Week</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.keys(selectedDays).map((day) => (
                <div key={day} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`day-${day}`} 
                    checked={selectedDays[day]}
                    onCheckedChange={(checked) => 
                      setSelectedDays({...selectedDays, [day]: !!checked})
                    }
                    className="data-[state=checked]:bg-orange-500"
                  />
                  <label htmlFor={`day-${day}`} className="text-sm">{day}</label>
                </div>
              ))}
            </div>
          </div>
          
          <div className="space-y-2">
            <span className="text-sm font-medium">Power State</span>
            <div className="flex space-x-4">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="powerOn"
                  checked={powerState}
                  onChange={() => setPowerState(true)}
                  className="accent-orange-500"
                />
                <label htmlFor="powerOn">Power ON</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="powerOff"
                  checked={!powerState}
                  onChange={() => setPowerState(false)}
                  className="accent-orange-500"
                />
                <label htmlFor="powerOff">Power OFF</label>
              </div>
            </div>
          </div>
          
          <Button 
            onClick={handleCreateSchedule}
            disabled={isCreating}
            className="w-full bg-orange-500 hover:bg-orange-600"
          >
            {isCreating ? "Creating..." : "Create Schedule"}
          </Button>
        </div>
      )}
      
      <div className="grid gap-4">
        {schedules && schedules.length > 0 ? (
          schedules.map((schedule) => (
            <div 
              key={schedule.id} 
              className="p-4 bg-black/20 border border-orange-500/20 rounded-lg"
            >
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div>
                  <h3 className="text-lg font-semibold">
                    {`Power ${schedule.state ? 'ON' : 'OFF'} Schedule`}
                  </h3>
                  <p className="text-sm text-gray-400">
                    {schedule.days_of_week.join(', ')} at {schedule.trigger_time}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <ScheduleStatusIndicator 
                    triggerTime={schedule.trigger_time} 
                    dayOfWeek={schedule.days_of_week[0]} 
                    systemId={systemId}
                  />
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteSchedule(schedule.id)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-500/10"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-gray-500 p-4 text-center border border-dashed border-gray-700 rounded-lg">
            No active schedules found. Create a new schedule to automate your inverter power.
          </div>
        )}
      </div>
      
      {schedules && schedules.length > 0 && (
        <div className="mt-6">
          <ScheduleDirectExecutor systemId={systemId} />
        </div>
      )}
      
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
