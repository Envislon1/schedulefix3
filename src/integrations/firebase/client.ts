import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, get } from 'firebase/database';
import { supabase } from '@/integrations/supabase/client';

const firebaseConfig = {
  apiKey: "AIzaSyCaJJ-2ExS5uGcH7jQ_9jwbHFIKLrj8J54",
  databaseURL: "https://powerverter-pro-default-rtdb.firebaseio.com/",
};

const app = initializeApp(firebaseConfig);
export const firebaseDb = getDatabase(app);

export const subscribeToDeviceData = (deviceId: string, callback: (data: any) => void) => {
  if (!deviceId) {
    console.error("Invalid deviceId provided to subscribeToDeviceData:", deviceId);
    return () => {}; // Return empty unsubscribe function
  }
  
  console.log(`Subscribing to Firebase device data for: _${deviceId}`);
  const deviceRef = ref(firebaseDb, `/_${deviceId}`);
  
  return onValue(deviceRef, (snapshot) => {
    const data = snapshot.val();
    console.log(`Received Firebase data for ${deviceId}:`, data);
    
    if (data) {
      // Convert legacy load names to new format if needed
      const formattedData = {
        ...data,
        load_1: data.load_1 ?? data.load1 ?? 0,
        load_2: data.load_2 ?? data.load2 ?? 0,
        load_3: data.load_3 ?? data.load3 ?? 0,
        load_4: data.load_4 ?? data.load4 ?? 0,
        load_5: data.load_5 ?? data.load5 ?? 0,
        load_6: data.load_6 ?? data.load6 ?? 0,
        power: data.power ?? 0 // Ensure power always has a value
      };
      callback(formattedData);
    } else {
      console.warn(`No data received from Firebase for device ${deviceId}`);
      // Return default structure to prevent undefined errors
      callback({
        power: 0,
        load_1: 0,
        load_2: 0,
        load_3: 0,
        load_4: 0,
        load_5: 0,
        load_6: 0
      });
    }
  }, (error) => {
    console.error(`Firebase subscription error for device ${deviceId}:`, error);
  });
};

export const setDevicePowerState = async (deviceId: string, state: boolean, isPriority: boolean = false) => {
  try {
    console.log(`Setting device ${deviceId} power state to ${state ? "ON" : "OFF"} ${isPriority ? "(PRIORITY)" : ""}`);
    
    if (!deviceId) {
      throw new Error("Invalid deviceId provided");
    }
    
    // FIXED: Make sure we're using the correct Firebase path format with leading underscore
    const deviceRef = ref(firebaseDb, `/_${deviceId}`);
    
    // First get current data to preserve other fields
    const snapshot = await get(deviceRef);
    const currentData = snapshot.val() || {};
    
    // Get current user's email
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || 'unknown';
    
    const updateData = {
      ...currentData,
      power: state ? 1 : 0,
      lastUserPower: userEmail,
      lastUpdate: new Date().toISOString(),
      // Add scheduledPowerChange data, critical for updating via schedules
      scheduledPowerChange: {
        timestamp: new Date().toISOString(),
        schedule_id: isPriority ? "ui-priority-update" : "manual",
        triggered_by: isPriority ? "schedule-system-via-ui" : userEmail,
        state: state ? 1 : 0
      }
    };
    
    console.log(`Updating Firebase with data:`, updateData);
    
    // Implement retry logic for Firebase updates
    let success = false;
    let attempts = 0;
    const maxAttempts = isPriority ? 5 : 3; // More attempts for priority updates
    
    while (!success && attempts < maxAttempts) {
      try {
        await set(deviceRef, updateData);
        success = true;
        console.log(`Successfully updated Firebase power state on attempt ${attempts + 1}`);
        
        // Verify the update actually worked
        const verifySnapshot = await get(deviceRef);
        const verifyData = verifySnapshot.val() || {};
        
        if (verifyData.power !== (state ? 1 : 0)) {
          console.error(`Verification failed: power state is ${verifyData.power} instead of ${state ? 1 : 0}`);
          throw new Error("Verification failed");
        }
        
        if (!verifyData.scheduledPowerChange || verifyData.scheduledPowerChange.state !== (state ? 1 : 0)) {
          console.error(`Verification failed: scheduledPowerChange state is missing or incorrect`);
          throw new Error("scheduledPowerChange verification failed");
        }
        
        console.log(`Verification successful: power=${verifyData.power}, scheduledPowerChange=${JSON.stringify(verifyData.scheduledPowerChange)}`);
      } catch (error) {
        attempts++;
        console.error(`Firebase power update attempt ${attempts} failed:`, error);
        if (attempts >= maxAttempts) throw error;
        // Wait longer before retrying for exponential backoff
        const waitTime = Math.pow(2, attempts) * 1000; // 2s, 4s, 8s...
        console.log(`Waiting ${waitTime}ms before retry attempt ${attempts + 1}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // Log to Supabase for auditing
    try {
      await supabase
        .from('scheduled_actions_log')
        .insert({
          system_id: deviceId,
          action: state ? "power_on" : "power_off",
          triggered_by: isPriority ? "schedule_via_ui" : "manual_ui",
          details: { 
            user: userEmail, 
            timestamp: new Date().toISOString(),
            firebase_data: updateData,
            is_priority: isPriority,
            verification_success: success
          }
        });
    } catch (error) {
      console.error('Error logging action to Supabase:', error);
      // Continue even if logging fails
    }
    
    return {
      success: true,
      attempts,
      final_attempt_success: success,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error setting device power state:', error);
    throw error;
  }
};

export const setDeviceLoadState = async (deviceId: string, loadNumber: number, state: boolean) => {
  try {
    if (!deviceId) {
      throw new Error("Invalid deviceId provided");
    }
    
    console.log(`Setting device ${deviceId} load ${loadNumber} to ${state ? "ON" : "OFF"}`);
    const deviceRef = ref(firebaseDb, `/_${deviceId}`);
    
    // First get current data to preserve other fields
    const snapshot = await get(deviceRef);
    const currentData = snapshot.val() || {};
    
    // Update the specific load state while preserving other load states and inverter state
    const loadStates = {
      load_1: currentData.load_1 ?? currentData.load1 ?? 0,
      load_2: currentData.load_2 ?? currentData.load2 ?? 0,
      load_3: currentData.load_3 ?? currentData.load3 ?? 0,
      load_4: currentData.load_4 ?? currentData.load4 ?? 0,
      load_5: currentData.load_5 ?? currentData.load5 ?? 0,
      load_6: currentData.load_6 ?? currentData.load6 ?? 0,
      power: currentData.power || 0, // Preserve inverter power state
    };
    
    // Update only the target load
    loadStates[`load_${loadNumber}`] = state ? 1 : 0;
    
    // Merge with current data and update timestamp
    const updateData = {
      ...currentData,
      ...loadStates,
      lastUpdate: new Date().toISOString()
    };
    
    console.log(`Updating Firebase with data:`, updateData);
    await set(deviceRef, updateData);
    
    return true;
  } catch (error) {
    console.error('Error setting device load state:', error);
    throw error;
  }
};

export const setAllDeviceStates = async (deviceId: string, updatePayload: any, isPriority: boolean = false) => {
  try {
    if (!deviceId) {
      throw new Error("Invalid deviceId provided");
    }
    
    console.log(`Setting all states for device ${deviceId}${isPriority ? ' (PRIORITY)' : ''}:`, updatePayload);
    const deviceRef = ref(firebaseDb, `/_${deviceId}`);
    
    // Get current data to preserve fields not in the update
    const snapshot = await get(deviceRef);
    const currentData = snapshot.val() || {};
    
    // Get current user's email for logging
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || 'unknown';
    
    const finalData = {
      ...currentData,
      ...updatePayload,
      lastUserPower: userEmail,
      lastUpdate: new Date().toISOString(),
      // Always include scheduledPowerChange when setting all device states
      scheduledPowerChange: {
        timestamp: new Date().toISOString(),
        schedule_id: isPriority ? "ui-priority-update" : "manual-update",
        triggered_by: isPriority ? "schedule-system-via-ui" : userEmail,
        state: ('power' in updatePayload) ? updatePayload.power : (currentData.power || 0)
      }
    };
    
    console.log(`Final data to be sent to Firebase:`, finalData);
    
    // Enhanced retry logic
    let success = false;
    let attempts = 0;
    const maxAttempts = isPriority ? 5 : 3;
    
    while (!success && attempts < maxAttempts) {
      try {
        await set(deviceRef, finalData);
        success = true;
        
        // Verify update
        const verifySnapshot = await get(deviceRef);
        const verifyData = verifySnapshot.val();
        
        if (!verifyData || 
            ('power' in updatePayload && verifyData.power !== updatePayload.power) ||
            !verifyData.scheduledPowerChange) {
          throw new Error("Verification failed");
        }
        
        console.log(`All device states updated successfully on attempt ${attempts + 1}`);
      } catch (error) {
        attempts++;
        console.error(`Firebase update attempt ${attempts} failed:`, error);
        if (attempts >= maxAttempts) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
      }
    }
    
    // Log to Supabase
    try {
      await supabase
        .from('scheduled_actions_log')
        .insert({
          system_id: deviceId,
          action: "update_all_states",
          triggered_by: isPriority ? "schedule_via_ui" : "manual_ui",
          details: { 
            user: userEmail, 
            timestamp: new Date().toISOString(),
            states_updated: Object.keys(updatePayload),
            is_priority: isPriority,
            verification_success: success
          }
        });
    } catch (error) {
      console.error('Error logging all states update to Supabase:', error);
    }
    
    return {
      success: true,
      attempts,
      final_attempt_success: success,
    };
  } catch (error) {
    console.error('Error updating all device states:', error);
    throw error;
  }
};
