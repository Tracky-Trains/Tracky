import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type TempUnit = 'F' | 'C';
export type DistanceUnit = 'mi' | 'km' | 'hotdogs';

interface UnitsContextType {
  tempUnit: TempUnit;
  distanceUnit: DistanceUnit;
  setTempUnit: (unit: TempUnit) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
}

const STORAGE_KEY = 'userPreferences';

const UnitsContext = createContext<UnitsContextType | undefined>(undefined);

export const useUnits = () => {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return ctx;
};

export const UnitsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tempUnit, setTempUnitState] = useState<TempUnit>('F');
  const [distanceUnit, setDistanceUnitState] = useState<DistanceUnit>('mi');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw) return;
      try {
        const prefs = JSON.parse(raw);
        if (prefs.tempUnit) setTempUnitState(prefs.tempUnit);
        if (prefs.distanceUnit) setDistanceUnitState(prefs.distanceUnit);
      } catch {}
    });
  }, []);

  const persist = (temp: TempUnit, dist: DistanceUnit) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ tempUnit: temp, distanceUnit: dist }));
  };

  const setTempUnit = (unit: TempUnit) => {
    setTempUnitState(unit);
    persist(unit, distanceUnit);
  };

  const setDistanceUnit = (unit: DistanceUnit) => {
    setDistanceUnitState(unit);
    persist(tempUnit, unit);
  };

  return (
    <UnitsContext.Provider value={{ tempUnit, distanceUnit, setTempUnit, setDistanceUnit }}>
      {children}
    </UnitsContext.Provider>
  );
};
