import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { SlideUpModalHandle } from '../components/ui/slide-up-modal';
import type { Stop, Train } from '../types/train';
import { logger } from '../utils/logger';

// Modal types that can be displayed
export type ModalType = 'main' | 'trainDetail' | 'departureBoard' | 'profile' | 'settings';

// Modal configuration for each type
export interface ModalConfig {
  type: ModalType;
  initialSnap?: 'min' | 'half' | 'max';
  data?: {
    train?: Train;
    station?: Stop;
  };
}

interface ModalContextType {
  // Current modal state
  activeModal: ModalType;
  modalData: {
    train: Train | null;
    station: Stop | null;
  };
  currentSnap: 'min' | 'half' | 'max';

  // Content visibility states (controls what renders inside always-mounted modal shells)
  showMainContent: boolean;
  showTrainDetailContent: boolean;
  showDepartureBoardContent: boolean;
  showProfileContent: boolean;
  showSettingsContent: boolean;

  // Modal refs for imperative control
  mainModalRef: React.RefObject<SlideUpModalHandle | null>;
  detailModalRef: React.RefObject<SlideUpModalHandle | null>;
  departureBoardRef: React.RefObject<SlideUpModalHandle | null>;
  profileModalRef: React.RefObject<SlideUpModalHandle | null>;
  settingsModalRef: React.RefObject<SlideUpModalHandle | null>;

  // Navigation stack for back navigation
  modalStack: ModalConfig[];

  // Transition functions
  navigateToTrain: (train: Train, options?: { fromMarker?: boolean; returnTo?: ModalType }) => void;
  navigateToStation: (station: Stop) => void;
  navigateToProfile: () => void;
  navigateToSettings: () => void;
  navigateToMain: () => void;
  goBack: () => void;
  dismissCurrent: () => void;

  // Internal handlers for modal animations
  handleModalDismissed: (type: ModalType) => void;
  handleSnapChange: (snap: 'min' | 'half' | 'max') => void;

  // Get initial snap for a modal type
  getInitialSnap: (type: ModalType) => 'min' | 'half' | 'max';
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModalContext = () => {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModalContext must be used within ModalProvider');
  return ctx;
};

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Refs for modal imperative handles
  const mainModalRef = useRef<SlideUpModalHandle | null>(null);
  const detailModalRef = useRef<SlideUpModalHandle | null>(null);
  const departureBoardRef = useRef<SlideUpModalHandle | null>(null);
  const profileModalRef = useRef<SlideUpModalHandle | null>(null);
  const settingsModalRef = useRef<SlideUpModalHandle | null>(null);

  // Content visibility states — modal shells are always mounted,
  // these control whether content renders inside them
  const [showMainContent, setShowMainContent] = useState(true);
  const [showTrainDetailContent, setShowTrainDetailContent] = useState(false);
  const [showDepartureBoardContent, setShowDepartureBoardContent] = useState(false);
  const [showProfileContent, setShowProfileContent] = useState(false);
  const [showSettingsContent, setShowSettingsContent] = useState(false);

  // Active modal tracking
  const [activeModal, setActiveModal] = useState<ModalType>('main');
  const [currentSnap, setCurrentSnap] = useState<'min' | 'half' | 'max'>('half');

  // Modal data
  const [modalData, setModalData] = useState<{
    train: Train | null;
    station: Stop | null;
  }>({ train: null, station: null });

  // Navigation stack for back navigation
  const [modalStack, setModalStack] = useState<ModalConfig[]>([]);

  // Track initial snap for next modal
  const nextModalSnapRef = useRef<'min' | 'half' | 'max'>('half');

  // For same-modal transitions (e.g. train→train), need sequential dismiss→slideIn
  const pendingSameModalRef = useRef<{ snap: 'min' | 'half' | 'max' } | null>(null);

  // Get initial snap for a modal type based on pending transition
  const getInitialSnap = useCallback((type: ModalType): 'min' | 'half' | 'max' => {
    return nextModalSnapRef.current;
  }, []);

  // Handle snap changes
  const handleSnapChange = useCallback((snap: 'min' | 'half' | 'max') => {
    setCurrentSnap(snap);
  }, []);

  // Helper: get ref for a modal type
  const getModalRef = useCallback((type: ModalType) => {
    if (type === 'main') return mainModalRef;
    if (type === 'trainDetail') return detailModalRef;
    if (type === 'profile') return profileModalRef;
    if (type === 'settings') return settingsModalRef;
    return departureBoardRef;
  }, []);

  // Helper: show content for a modal type
  const showContent = useCallback((type: ModalType) => {
    if (type === 'main') setShowMainContent(true);
    else if (type === 'trainDetail') setShowTrainDetailContent(true);
    else if (type === 'departureBoard') setShowDepartureBoardContent(true);
    else if (type === 'profile') setShowProfileContent(true);
    else if (type === 'settings') setShowSettingsContent(true);
  }, []);

  // Navigate to train detail modal
  const navigateToTrain = useCallback(
    (train: Train, options?: { fromMarker?: boolean; returnTo?: ModalType }) => {
      const fromMarker = options?.fromMarker ?? false;
      const returnTo = options?.returnTo;

      // If already showing this exact train, do nothing
      if (activeModal === 'trainDetail' && modalData.train?.tripId && modalData.train.tripId === train.tripId) {
        return;
      }

      const targetSnap = fromMarker ? 'half' : 'max';
      nextModalSnapRef.current = targetSnap;

      // Store the return destination if coming from departure board
      const returnConfig: ModalConfig | null =
        returnTo === 'departureBoard' && modalData.station
          ? { type: 'departureBoard', initialSnap: 'half', data: { station: modalData.station } }
          : null;

      if (returnConfig) {
        setModalStack(prev => [...prev, returnConfig]);
      }

      // Set data and show content immediately
      logger.info(`[Nav] Open train detail: #${train.trainNumber} ${train.from} → ${train.to}`);
      setModalData(prev => ({ ...prev, train }));
      setShowTrainDetailContent(true);
      setActiveModal('trainDetail');

      if (activeModal === 'trainDetail') {
        // Same-modal transition: dismiss first, slideIn after dismiss completes
        pendingSameModalRef.current = { snap: targetSnap };
        detailModalRef.current?.dismiss?.(true);
      } else {
        // Different modal: dismiss old + slide in new simultaneously
        getModalRef(activeModal).current?.dismiss?.(true);
        detailModalRef.current?.slideIn?.(targetSnap);
      }
    },
    [activeModal, modalData.train, modalData.station, getModalRef]
  );

  // Navigate to station departure board
  const navigateToStation = useCallback(
    (station: Stop) => {
      // If already showing this exact station, do nothing
      if (activeModal === 'departureBoard' && modalData.station?.stop_id && modalData.station.stop_id === station.stop_id) {
        return;
      }

      nextModalSnapRef.current = 'half';

      // Set data and show content immediately
      logger.info(`[Nav] Open departure board: ${station.stop_name} (${station.stop_id})`);
      setModalData(prev => ({ ...prev, station }));
      setShowDepartureBoardContent(true);
      setActiveModal('departureBoard');

      if (activeModal === 'departureBoard') {
        // Same-modal transition: dismiss first, slideIn after
        pendingSameModalRef.current = { snap: 'half' };
        departureBoardRef.current?.dismiss?.(true);
      } else {
        // Different modal: dismiss old + slide in new simultaneously
        getModalRef(activeModal).current?.dismiss?.(true);
        departureBoardRef.current?.slideIn?.('half');
      }
    },
    [activeModal, modalData.station, getModalRef]
  );

  // Navigate to profile modal
  const navigateToProfile = useCallback(() => {
    if (activeModal === 'profile') return;
    logger.info('[Nav] Open profile');

    nextModalSnapRef.current = 'half';

    // Push current modal onto stack so back returns to it
    setModalStack(prev => [...prev, { type: activeModal, initialSnap: 'half' }]);

    setShowProfileContent(true);
    setActiveModal('profile');

    getModalRef(activeModal).current?.dismiss?.(true);
    profileModalRef.current?.slideIn?.('half');
  }, [activeModal, getModalRef]);

  // Navigate to settings modal (full screen)
  const navigateToSettings = useCallback(() => {
    if (activeModal === 'settings') return;
    logger.info('[Nav] Open settings');

    nextModalSnapRef.current = 'max';

    // Push current modal onto stack so back returns to it
    setModalStack(prev => [...prev, { type: activeModal, initialSnap: 'half' }]);

    setShowSettingsContent(true);
    setActiveModal('settings');

    getModalRef(activeModal).current?.dismiss?.(true);
    settingsModalRef.current?.slideIn?.('max');
  }, [activeModal, getModalRef]);

  // Navigate back to main modal
  const navigateToMain = useCallback(() => {
    nextModalSnapRef.current = 'half';

    // Clear stack
    setModalStack([]);

    // Show main content and slide in
    setShowMainContent(true);
    setActiveModal('main');

    // Simultaneously: dismiss old + slide in new
    getModalRef(activeModal).current?.dismiss?.(true);
    mainModalRef.current?.slideIn?.('half');
  }, [activeModal, getModalRef]);

  // Go back in the stack
  const goBack = useCallback(() => {
    if (modalStack.length > 0) {
      const returnTo = modalStack[modalStack.length - 1];
      const targetSnap = returnTo.initialSnap || 'half';
      nextModalSnapRef.current = targetSnap;

      // Pop the stack
      setModalStack(prev => prev.slice(0, -1));

      // Update data if needed
      if (returnTo.data?.train) {
        setModalData(prev => ({ ...prev, train: returnTo.data!.train! }));
      }
      if (returnTo.data?.station) {
        setModalData(prev => ({ ...prev, station: returnTo.data!.station! }));
      }

      // Show target content and slide in
      showContent(returnTo.type);
      setActiveModal(returnTo.type);

      // Simultaneously: dismiss old + slide in target
      getModalRef(activeModal).current?.dismiss?.(true);
      getModalRef(returnTo.type).current?.slideIn?.(targetSnap);
    } else {
      // No stack, go to main
      navigateToMain();
    }
  }, [modalStack, activeModal, navigateToMain, getModalRef, showContent]);

  // Dismiss current modal without navigation (just closes it)
  const dismissCurrent = useCallback(() => {
    goBack();
  }, [goBack]);

  // Handle when a modal finishes its dismiss animation
  const handleModalDismissed = useCallback((type: ModalType) => {
    // Check if this is a same-modal transition (e.g. train→train)
    const pending = pendingSameModalRef.current;
    if (pending) {
      pendingSameModalRef.current = null;
      // Content was already updated, just slide back in with new content
      getModalRef(type).current?.slideIn?.(pending.snap);
      return;
    }

    // Hide content of the dismissed modal to free resources
    // Main and profile modals stay mounted to avoid re-initialization flash
    if (type === 'trainDetail') setShowTrainDetailContent(false);
    else if (type === 'departureBoard') setShowDepartureBoardContent(false);
    else if (type === 'settings') setShowSettingsContent(false);
  }, [getModalRef]);

  const value: ModalContextType = {
    activeModal,
    modalData,
    currentSnap,
    showMainContent,
    showTrainDetailContent,
    showDepartureBoardContent,
    showProfileContent,
    showSettingsContent,
    mainModalRef,
    detailModalRef,
    departureBoardRef,
    profileModalRef,
    settingsModalRef,
    modalStack,
    navigateToTrain,
    navigateToStation,
    navigateToProfile,
    navigateToSettings,
    navigateToMain,
    goBack,
    dismissCurrent,
    handleModalDismissed,
    handleSnapChange,
    getInitialSnap,
  };

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
};
