import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatWestAfricaTime, timeAgo } from "@/utils/westAfricaTime";

interface DeviceStatusMonitorProps {
  inverterId: string;
  deviceData?: string;
  refreshInterval?: number;
}

export const DeviceStatusMonitor = ({
  inverterId,
  deviceData,
  refreshInterval = 10000,
}: DeviceStatusMonitorProps) => {
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const lastRandomValueRef = useRef<number>(0);

  useEffect(() => {
    if (!deviceData) {
      setIsOnline(false);
      return;
    }

    try {
      const values = deviceData.split(',');
      const currentRandomValue = parseInt(values[20]) || 0;

      if (currentRandomValue !== lastRandomValueRef.current) {
        lastRandomValueRef.current = currentRandomValue;
        setLastUpdateTime(Date.now());
        setIsOnline(true);
      }
    } catch (error) {
      console.error('Error parsing device data:', error);
    }
  }, [deviceData]);

  useEffect(() => {
    const timer = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      if (timeSinceLastUpdate > refreshInterval) {
        setIsOnline(false);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [refreshInterval, lastUpdateTime]);

  useEffect(() => {
    const setupRealtimeSubscription = async () => {
      const { data: inverterData, error: inverterError } = await supabase
        .from('inverter_systems')
        .select('system_id')
        .eq('id', inverterId)
        .single();
        
      if (inverterError || !inverterData) {
        console.error('Error getting system_id:', inverterError);
        return;
      }
      
      const subscription = supabase
        .channel('device_data_changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'device_data',
            filter: `device_id=eq.${inverterData.system_id}`
          },
          (payload) => {
            if (payload.new && typeof payload.new.data === 'string') {
              const values = payload.new.data.split(',');
              const newRandomValue = parseInt(values[20]) || 0;
              
              if (newRandomValue !== lastRandomValueRef.current) {
                lastRandomValueRef.current = newRandomValue;
                setLastUpdateTime(Date.now());
                setIsOnline(true);
              }
            }
          }
        )
        .subscribe();
        
      return () => {
        subscription.unsubscribe();
      };
    };
    
    if (inverterId) {
      setupRealtimeSubscription();
    }
  }, [inverterId]);

  const getTimeAgo = () => {
    if (!lastUpdateTime) return "";
    const timeStr = formatWestAfricaTime(lastUpdateTime, "yyyy-MM-dd HH:mm:ss");
    return `${timeAgo(lastUpdateTime)} (${timeStr} WAT)`;
  };

  return (
    <div className="flex items-center space-x-2">
      {isOnline ? (
        <>
          <Wifi className="h-4 w-4 text-green-500" />
          <span className="text-xs text-green-400">Online</span>
          {lastUpdateTime > 0 && (
            <span className="text-xs text-gray-400">
              • Last update: {getTimeAgo()}
            </span>
          )}
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4 text-red-500" />
          <span className="text-xs text-red-400">Offline</span>
          {lastUpdateTime > 0 && (
            <span className="text-xs text-gray-400">
              • Last seen: {getTimeAgo()}
            </span>
          )}
        </>
      )}
    </div>
  );
};
