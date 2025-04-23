
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { forceExecuteSchedule, manuallyTriggerScheduleCheck, logScheduleDiagnostics } from '@/utils/scheduleUtils';
import { toast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Bell, Bug, Info, AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface ScheduleDirectExecutorProps {
  systemId: string;
}

export const ScheduleDirectExecutor: React.FC<ScheduleDirectExecutorProps> = ({ systemId }) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executingScheduleId, setExecutingScheduleId] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [lastAction, setLastAction] = useState<{time: string, action: string, success: boolean} | null>(null);
  const [firebaseStatus, setFirebaseStatus] = useState<string | null>(null);
  
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
  
  // Check for recent schedule executions
  useEffect(() => {
    if (!systemId || !debugMode) return;
    
    const checkRecentExecutions = async () => {
      const { data, error } = await supabase
        .from('scheduled_actions_log')
        .select('*')
        .eq('system_id', systemId)
        .order('created_at', { ascending: false })
        .limit(1);
        
      if (!error && data && data.length > 0) {
        const execution = data[0];
        // Safely access the success property from details
        const details = execution.details;
        let success = false;
        
        // Check if details is an object with a success property
        if (details && typeof details === 'object' && 'success' in details) {
          success = Boolean(details.success);
        }
        
        setLastAction({
          time: new Date(execution.created_at).toLocaleTimeString(),
          action: execution.action,
          success: success
        });
        
        // If this is a recent execution (within last minute), check Firebase status
        const executionTime = new Date(execution.created_at);
        const now = new Date();
        if ((now.getTime() - executionTime.getTime()) < 60000) { // Within last minute
          checkFirebaseStatus();
        }
      }
    };
    
    // Check Firebase connection 
    const checkFirebaseStatus = async () => {
      try {
        // Call directly to the functions to verify Firebase access
        const response = await supabase.functions.invoke("scheduled-inverter-control", {
          method: "POST",
          body: {
            system_id: systemId,
            test_mode: true,
            manual_execution: false,
            diagnostic_check: true
          }
        });
        
        // Safely access the connection_status property from the response data
        let connectionStatus = "Check completed";
        if (response.data && typeof response.data === 'object') {
          connectionStatus = response.data.connection_status || connectionStatus;
        }
        
        setFirebaseStatus(connectionStatus);
        
        // Log diagnostic information
        await logScheduleDiagnostics(systemId, "Firebase connection check", {
          timestamp: new Date().toISOString(),
          result: response
        });
      } catch (err) {
        setFirebaseStatus(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
        console.error("Firebase status check failed:", err);
      }
    };
    
    checkRecentExecutions();
    const interval = setInterval(checkRecentExecutions, 10000);
    
    return () => clearInterval(interval);
  }, [systemId, debugMode]);
  
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
      
      // Update last action for debug mode
      setLastAction({
        time: new Date().toLocaleTimeString(),
        action: result.schedule.state ? "power_on" : "power_off",
        success: true
      });
      
      // Show success toast
      toast({
        title: "Schedule Executed",
        description: `Power has been turned ${result.schedule.state ? 'ON' : 'OFF'} successfully.`,
      });
      
      // Add a debug toast with detailed info
      if (debugMode) {
        toast({
          title: "Debug: Schedule Execution Details",
          description: `System ID: ${systemId}, Schedule ID: ${scheduleId}, Firebase update successful`,
        });
        
        // Call the manual trigger function to double-check schedule execution
        setTimeout(async () => {
          try {
            await manuallyTriggerScheduleCheck(
              systemId,
              result.schedule.trigger_time,
              result.schedule.days_of_week[0],
              false // Just check, don't execute again
            );
            
            toast({
              title: "Debug: Schedule Check",
              description: "Manual schedule validation completed successfully",
            });
          } catch (err) {
            console.error("Debug check error:", err);
          }
        }, 2000);
      }
      
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
      
      // Update last action for debug mode
      setLastAction({
        time: new Date().toLocaleTimeString(),
        action: "error",
        success: false
      });
      
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
  
  // Function to run a direct Firebase test
  const runFirebaseTest = async () => {
    try {
      toast({
        title: "Testing Firebase Connection",
        description: "Sending a direct test command...",
      });
      
      // Try to update the power state directly via the function
      const response = await supabase.functions.invoke("scheduled-inverter-control", {
        method: "POST",
        body: {
          system_id: systemId,
          state: true, // Try to turn it ON
          user_email: "debug-test@firebase.check",
          manual_execution: true,
          test_mode: false
        }
      });
      
      // Safely check the success property from the response
      let wasSuccessful = false;
      if (response.data && typeof response.data === 'object') {
        wasSuccessful = !!response.data.success;
      }
      
      if (wasSuccessful) {
        toast({
          title: "Firebase Test Successful",
          description: "Direct power control command succeeded. The inverter should turn ON.",
        });
      } else {
        toast({
          title: "Firebase Test Failed",
          description: "The command was sent but may have failed on the server side.",
          variant: "destructive",
        });
      }
      
      // Log the test result
      await logScheduleDiagnostics(systemId, "Manual Firebase test", {
        timestamp: new Date().toISOString(),
        result: response
      });
    } catch (err) {
      console.error("Firebase test failed:", err);
      toast({
        title: "Firebase Test Failed",
        description: err instanceof Error ? err.message : "Unknown error occurred",
        variant: "destructive",
      });
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
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Active Schedules</h3>
        <div className="flex items-center space-x-2">
          <Bug className={`h-4 w-4 ${debugMode ? 'text-orange-500' : 'text-gray-500'}`} />
          <Switch 
            checked={debugMode} 
            onCheckedChange={setDebugMode}
            className="data-[state=checked]:bg-orange-500"
          />
          <span className="text-sm">Debug Mode</span>
        </div>
      </div>
      
      {debugMode && (
        <div className="bg-black/40 p-3 border border-orange-500/30 rounded-md text-sm space-y-2">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-orange-500" />
            <span>Schedule Debug Mode Active</span>
          </div>
          <p className="text-xs text-gray-400">
            Debug mode will provide additional information about schedule execution and
            check for server-side failures. The Power Switch component will also show
            visual indicators when schedule actions are detected.
          </p>
          
          {lastAction && (
            <div className={`text-xs p-2 rounded border ${lastAction.success ? 'border-green-500/30 bg-green-900/10' : 'border-red-500/30 bg-red-900/10'}`}>
              Last action: <span className="font-mono">{lastAction.action}</span> at {lastAction.time} 
              {lastAction.success ? ' (Success)' : ' (Failed)'}
            </div>
          )}
          
          {firebaseStatus && (
            <div className="text-xs p-2 rounded border border-blue-500/30 bg-blue-900/10">
              Firebase connection status: {firebaseStatus}
            </div>
          )}
          
          <Button 
            variant="outline" 
            size="sm"
            onClick={runFirebaseTest}
            className="border-orange-500/40 text-orange-500 hover:bg-orange-500/20"
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Test Firebase Connection
          </Button>
        </div>
      )}
      
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
