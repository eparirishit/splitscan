"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from "next/navigation";
import {
  AppFlow,
  Step,
  BillData,
  BillItem,
  User,
  Group
} from '@/types';
import { StepProgress } from '@/components/bill-splitter/StepProgress';
import { GroupSelector } from '@/components/bill-splitter/GroupSelector';
import { ItemSplitter } from '@/components/bill-splitter/ItemSplitter';
import { ReviewScreen } from '@/components/bill-splitter/ReviewScreen';
import { ProfileOverlay } from '@/components/bill-splitter/ProfileOverlay';
import { FeedbackOverlay } from '@/components/bill-splitter/FeedbackOverlay';
import { DashboardView } from '@/components/bill-splitter/DashboardView';
import { AdminPanel } from '@/components/bill-splitter/AdminPanel';
import { Logo } from '@/components/icons/logo';
import { SplitwiseLogoIcon } from "@/components/icons/SplitwiseLogoIcon";
import { useAuth } from '@/hooks/use-auth';
import { SplitwiseService } from '@/services/splitwise';
import { extractReceiptData } from '@/ai/extract-receipt-data';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Play, X } from 'lucide-react';
import { AnalyticsClientService } from '@/services/analytics-client';
import { getFlowState, saveFlowState, getAllDrafts, deleteFlowState, type FlowStateSnapshot } from '@/services/flow-state-service';
import { supabase, generateImageHash } from '@/lib/supabase';

// MOCK CONSTANTS (Fallbacks)
const DEFAULT_BILL: BillData = {
  id: '',
  storeName: '',
  date: new Date().toLocaleDateString('en-CA'),
  items: [],
  tax: 0,
  discount: 0,
  otherCharges: 0,
  total: 0,
  currency: 'USD',
  notes: '',
  payerId: '',
  groupId: null,
  selectedMemberIds: [],
  source: AppFlow.NONE
};

function BillSplitterFlow() {
  const router = useRouter();
  const { toast } = useToast();
  const { isAuthenticated, isLoading: isAuthLoading, login, logout } = useAuth();

  // App State
  const [flow, setFlow] = useState<AppFlow>(AppFlow.NONE);
  const [currentStep, setCurrentStep] = useState<Step>(Step.FLOW_SELECTION);
  const [billData, setBillData] = useState<BillData>({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9) });
  const [originalBillData, setOriginalBillData] = useState<string>('');
  const [originalExtraction, setOriginalExtraction] = useState<any>(null); // Store original AI extraction for correction tracking
  const [receiptId, setReceiptId] = useState<string | null>(null); // Store receipt ID from tracking
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null); // Track if we're editing an existing expense
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [savedFlowState, setSavedFlowState] = useState<FlowStateSnapshot | null>(null);

  // Theme State
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // Data State
  const [authUser, setAuthUser] = useState<any>(null); // To store current user details
  const [groups, setGroups] = useState<Group[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [history, setHistory] = useState<any[]>([]); // Using any for history items for now to match structure
  const [drafts, setDrafts] = useState<FlowStateSnapshot[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Effects
  // Scroll to top when navigating between screens
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentStep, showAdmin]);

  // Initialize Theme
  useEffect(() => {
    // Check local storage or preference
    const isDark = localStorage.getItem('bill_splitter_theme') === 'dark' ||
      (!localStorage.getItem('bill_splitter_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDarkMode(isDark);
  }, []);

  // Update Theme
  useEffect(() => {
    const el = document.documentElement;
    if (darkMode) el.classList.add('dark');
    else el.classList.remove('dark');
    localStorage.setItem('bill_splitter_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Load Groups and Friends when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const loadData = async () => {
        setIsLoadingData(true);
        try {
          const [fetchedGroups, fetchedFriends, fetchedUser] = await Promise.all([
            SplitwiseService.getRecentGroups(),
            SplitwiseService.getFriends(),
            SplitwiseService.getCurrentUser()
          ]);

          setAuthUser(fetchedUser);

          // Check admin status
          if (fetchedUser?.id) {
            try {
              const adminStatus = await AnalyticsClientService.checkAdminStatus();
              setIsAdmin(adminStatus);
            } catch (error) {
              console.warn('Failed to check admin status:', error);
              setIsAdmin(false);
            }
          }

          // Map to new UI types
          const mappedGroups: Group[] = fetchedGroups.map(g => ({
            id: g.id,
            name: g.name,
            members: g.members.map(m => ({
              id: m.id,
              name: `${m.first_name} ${m.last_name || ''}`.trim(),
              email: m.email,
              avatar: m.picture?.medium || `https://ui-avatars.com/api/?name=${m.first_name}&background=random`
            }))
          }));

          const mappedFriends: User[] = fetchedFriends.map(f => ({
            id: f.id,
            name: `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.email || 'Unknown',
            email: f.email || undefined,
            avatar: f.picture?.medium || `https://ui-avatars.com/api/?name=${f.first_name || 'F'}&background=random`
          }));

          setGroups(mappedGroups);
          setFriends(mappedFriends);
        } catch (error) {
          console.error("Failed to load Splitwise data", error);
          toast({
            title: "Data Load Error",
            description: "Could not fetch groups or friends. Please check connection.",
            variant: "destructive"
          });
        } finally {
          setIsLoadingData(false);
        }
      };

      loadData();
    }
  }, [isAuthenticated, toast]);

  // Analytics state
  const [analytics, setAnalytics] = useState({
    totalVolume: 0,
    monthlyVolume: 0,
    scanCount: 0,
    manualCount: 0
  });

  // Fetch saved flow state for cross-device resume (when at dashboard)
  useEffect(() => {
    if (!isAuthenticated || !authUser?.id || currentStep !== Step.FLOW_SELECTION) return;
    let cancelled = false;

    const refreshStates = () => {
      Promise.all([
        getFlowState(),
        getAllDrafts()
      ]).then(([state, allDrafts]) => {
        if (cancelled) return;

        // Handle last active pill
        if (state) {
          const step = state.currentStep;
          const hasProgress = step > Step.FLOW_SELECTION && step < Step.SUCCESS && state.billData != null;
          if (hasProgress) setSavedFlowState(state);
          else setSavedFlowState(null);
        } else {
          setSavedFlowState(null);
        }

        // Handle other drafts list
        if (allDrafts) {
          // Only show drafts that are not the last active one and have actual progress
          setDrafts(allDrafts.filter(d =>
            !d.isLastActive &&
            (d.currentStep || 0) > Step.FLOW_SELECTION &&
            (d.currentStep || 0) < Step.SUCCESS
          ));
        }
      });
    };

    refreshStates();

    // Refresh when window regains focus (good for cross-device switching)
    window.addEventListener('focus', refreshStates);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshStates);
    };
  }, [isAuthenticated, authUser?.id, currentStep]);

  // Debounced save of flow state for cross-device resume
  const saveFlowStateRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !authUser?.id || flow === AppFlow.NONE || currentStep < Step.UPLOAD || currentStep > Step.REVIEW) return;
    saveFlowStateRef.current && clearTimeout(saveFlowStateRef.current);
    saveFlowStateRef.current = setTimeout(() => {
      saveFlowStateRef.current = null;
      const previewUrl = typeof previewImage === 'string' && previewImage.startsWith('http') ? previewImage : null;
      saveFlowState({
        flow: flow,
        currentStep,
        billData: billData as unknown as Record<string, unknown>,
        previewImageUrl: previewUrl,
      }).catch(() => { });
    }, 2500);
    return () => {
      if (saveFlowStateRef.current) clearTimeout(saveFlowStateRef.current);
    };
  }, [isAuthenticated, authUser?.id, flow, currentStep, billData, previewImage]);

  // Load History and Analytics
  useEffect(() => {
    const loadHistoryAndAnalytics = async () => {
      // Try to load from database if authenticated
      if (isAuthenticated && authUser?.id) {
        try {
          // Load history (last 5 items)
          const historyResponse = await AnalyticsClientService.getExpenseHistory(
            5, // Limit to last 5 transactions
            0
          );

          if (historyResponse?.data && historyResponse.data.length > 0) {
            // Map database records to history format (include created_at for monthly calc)
            const mappedHistory = historyResponse.data.map((item: { id: string; store_name: string; date: string; total: number; source: string; created_at?: string }) => ({
              id: item.id,
              storeName: item.store_name,
              date: item.date,
              total: item.total,
              source: item.source,
              created_at: item.created_at
            }));
            setHistory(mappedHistory);

            // Also update localStorage as backup
            localStorage.setItem('bill_splitter_history', JSON.stringify(mappedHistory));
          }

          // Load analytics counts from database (all expenses, not just last 5)
          const expenseCounts = await AnalyticsClientService.getUserExpenseCounts();
          if (expenseCounts) {
            setAnalytics(expenseCounts);
          } else {
            // Fallback: fetch more history (up to 100) and compute when getUserExpenseCounts fails
            const fallbackResponse = await AnalyticsClientService.getExpenseHistory(100, 0);
            const fallbackHistory = fallbackResponse?.data || historyResponse?.data || [];
            const now = new Date();
            const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const norm = (s: string) => (s || '').toLowerCase();
            const isCurrentMonth = (h: any) => {
              const ts = h.created_at ?? h.date;
              if (!ts) return false;
              return String(ts).substring(0, 7) === currentMonthStr;
            };
            setAnalytics({
              totalVolume: fallbackHistory.reduce((sum: number, h: any) => sum + (Number(h.total) || 0), 0),
              monthlyVolume: fallbackHistory.filter(isCurrentMonth).reduce((sum: number, h: any) => sum + (Number(h.total) || 0), 0),
              scanCount: fallbackHistory.filter((h: any) => norm(h.source) === 'scan').length,
              manualCount: fallbackHistory.filter((h: any) => norm(h.source) === 'manual').length
            });
          }
          return;
        } catch (error) {
          console.warn('Failed to load history/analytics from database:', error);
          // Fall through to localStorage
        }
      }

      // Fallback to localStorage
      const savedHistory = localStorage.getItem('bill_splitter_history');
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        // Limit to 5 items
        setHistory(parsed.slice(0, 5));
        const now = new Date();
        const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const norm = (s: string) => (s || '').toLowerCase();
        setAnalytics({
          totalVolume: parsed.reduce((sum: number, h: any) => sum + (Number(h.total) || 0), 0),
          monthlyVolume: parsed
            .filter((h: any) => {
              if (!h.date) return false;
              return String(h.date).substring(0, 7) === currentMonthStr;
            })
            .reduce((sum: number, h: any) => sum + (Number(h.total) || 0), 0),
          scanCount: parsed.filter((h: any) => norm(h.source) === 'scan').length,
          manualCount: parsed.filter((h: any) => norm(h.source) === 'manual').length
        });
      }
    };

    loadHistoryAndAnalytics();
  }, [isAuthenticated, authUser]);

  // Auth Redirect
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated && currentStep !== Step.AUTH) {
      // Allow staying on AUTH step if managed there to avoid loop
      // But if we are deeper, redirect or show auth
    }
  }, [isAuthenticated, isAuthLoading, currentStep]);


  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleLogin = () => {
    // Direct redirect to API which handles Splitwise OAuth
    login();
  };

  const startNewSplit = () => {
    setFlow(AppFlow.NONE);
    setCurrentStep(Step.FLOW_SELECTION);
    setBillData({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9) });
    setPreviewImage(null);
    setOriginalBillData('');
    setEditingExpenseId(null); // Clear editing state
    setOriginalExtraction(null);
    setReceiptId(null);
    setShowFeedback(false);
    setSavedFlowState(null);
  };

  const cancelEdit = () => {
    setEditingExpenseId(null);
    setBillData({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9) });
    setPreviewImage(null);
    setOriginalExtraction(null);
    setReceiptId(null);
    setFlow(AppFlow.NONE);
    setCurrentStep(Step.FLOW_SELECTION);
  };

  const handleGoHome = () => {
    // Save current state explicitly before going home to ensure banner appears
    if (authUser?.id && flow !== AppFlow.NONE && currentStep > Step.FLOW_SELECTION && currentStep < Step.SUCCESS) {
      saveFlowState({
        flow,
        currentStep,
        billData: billData as unknown as Record<string, unknown>,
        previewImageUrl: previewImage,
      }).catch(() => { });
    }

    // Refresh drafts list and go home
    if (authUser?.id) {
      getAllDrafts().then(allDrafts => {
        setDrafts(allDrafts.filter(d => !d.isLastActive && (d.currentStep || 0) > Step.FLOW_SELECTION && (d.currentStep || 0) < Step.SUCCESS));
      }).catch(() => { });
      getFlowState().then(state => {
        setSavedFlowState(state);
      }).catch(() => { });
    }

    setFlow(AppFlow.NONE);
    setCurrentStep(Step.FLOW_SELECTION);
    setShowFeedback(false);
  };

  /** Discard current expense and return to home. This deletes the draft from the database. */
  const discardExpenseAndGoHome = async () => {
    const currentBillId = billData.id;
    setEditingExpenseId(null);
    setBillData({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9) });
    setPreviewImage(null);
    setOriginalExtraction(null);
    setReceiptId(null);
    setFlow(AppFlow.NONE);
    setCurrentStep(Step.FLOW_SELECTION);
    setShowFeedback(false);
    setSavedFlowState(null);

    // Delete the draft from DB
    if (authUser?.id && currentBillId) {
      try {
        await deleteFlowState(currentBillId);
        // Refresh drafts list
        const allDrafts = await getAllDrafts();
        setDrafts(allDrafts.filter(d => !d.isLastActive && (d.currentStep || 0) > Step.FLOW_SELECTION && (d.currentStep || 0) < Step.SUCCESS));
      } catch (err) {
        console.error('Failed to delete draft on discard:', err);
      }
    }
  };

  const handleResumeFromSaved = () => {
    if (!savedFlowState) return;
    const flowEnum = savedFlowState.flow === AppFlow.SCAN ? AppFlow.SCAN : savedFlowState.flow === AppFlow.MANUAL ? AppFlow.MANUAL : AppFlow.NONE;
    setFlow(flowEnum);
    setCurrentStep(savedFlowState.currentStep as Step);
    const restored = savedFlowState.billData as unknown as BillData;
    if (restored && typeof restored === 'object') {
      setBillData({
        ...restored,
        id: restored.id || Math.random().toString(36).substr(2, 9),
      });
    }
    setPreviewImage(savedFlowState.previewImageUrl || null);
    setSavedFlowState(null);
    toast({ title: 'Resumed', description: 'Continue where you left off.' });
  };

  const handleResumeFromDraft = (draft: FlowStateSnapshot) => {
    const flowEnum = draft.flow === AppFlow.SCAN ? AppFlow.SCAN : draft.flow === AppFlow.MANUAL ? AppFlow.MANUAL : AppFlow.NONE;
    setFlow(flowEnum);
    setCurrentStep(draft.currentStep as Step);
    const restored = draft.billData as unknown as BillData;
    if (restored && typeof restored === 'object') {
      setBillData({
        ...restored,
        id: restored.id || Math.random().toString(36).substr(2, 9),
      });
    }
    setPreviewImage(draft.previewImageUrl || null);
    toast({ title: 'Draft Restored', description: `Resumed session for ${draft.storeName || 'Untitled Split'}` });
  };

  const handleDeleteDraft = async (draft: FlowStateSnapshot) => {
    if (!authUser?.id || !draft.billId) return;

    // Optimistic UI update
    setDrafts(prev => prev.filter(d => d.billId !== draft.billId));

    try {
      const success = await deleteFlowState(draft.billId);
      if (success) {
        toast({ title: 'Draft Deleted', description: 'The draft has been removed.' });
      } else {
        throw new Error('Failed to delete');
      }
    } catch (error) {
      console.error('Error deleting draft:', error);
      // Revert optimistic update
      const allDrafts = await getAllDrafts();
      setDrafts(allDrafts.filter(d => !d.isLastActive && (d.currentStep || 0) < Step.SUCCESS));
      toast({ title: 'Error', description: 'Failed to delete the draft. Please try again.', variant: 'destructive' });
    }
  };

  const handleDismissResume = () => {
    setSavedFlowState(null);
    if (authUser?.id && savedFlowState?.billId) {
      // Mark as not last active in backend
      saveFlowState({
        flow: 'NONE', // This will set is_last_active: false in the API
        currentStep: savedFlowState.currentStep,
        billData: savedFlowState.billData as any,
      }).catch(() => { });
    }
  };

  const handleEditHistorical = async (item: any) => {
    if (!authUser?.id) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to edit expenses.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Try to load full expense data from database
      const expenseRecord = await AnalyticsClientService.getExpenseById(item.id);

      if (expenseRecord?.bill_data) {
        // Restore full bill data
        const restoredBillData: BillData = {
          ...expenseRecord.bill_data,
          id: expenseRecord.bill_data.id || Math.random().toString(36).substr(2, 9), // Ensure ID exists
        };

        setBillData(restoredBillData);
        setEditingExpenseId(expenseRecord.id); // Set editing ID

        // Set the flow based on source
        if (expenseRecord.source === 'scan') {
          setFlow(AppFlow.SCAN);
        } else {
          setFlow(AppFlow.MANUAL);
        }

        // Navigate to item splitter step
        setCurrentStep(Step.ITEM_SPLITTING);

        toast({
          title: "Expense Loaded",
          description: "You can now edit this expense."
        });
      } else if (expenseRecord) {
        // Expense exists but bill_data is missing - log for debugging
        console.warn('Expense found but bill_data is missing:', {
          id: expenseRecord.id,
          source: expenseRecord.source,
          storeName: expenseRecord.store_name
        });

        toast({
          title: "Expense Details Not Found",
          description: "Full expense details are not available. Cannot edit this expense."
        });
        return;
      } else {
        // Fallback: try to restore from localStorage or show basic info
        const savedHistory = localStorage.getItem('bill_splitter_history');
        if (savedHistory) {
          const parsed = JSON.parse(savedHistory);
          const foundItem = parsed.find((h: any) => h.id === item.id);

          if (foundItem && foundItem.billData) {
            setBillData(foundItem.billData);
            setEditingExpenseId(item.id); // Set editing ID
            setFlow(foundItem.source === 'scan' ? AppFlow.SCAN : AppFlow.MANUAL);
            setCurrentStep(Step.ITEM_SPLITTING);
            toast({
              title: "Expense Loaded",
              description: "You can now edit this expense."
            });
          } else {
            toast({
              title: "Expense Details Not Found",
              description: "Full expense details are not available. Cannot edit this expense."
            });
            // Don't create a new expense, just show warning
            return;
          }
        } else {
          toast({
            title: "Expense Details Not Found",
            description: "Could not load expense data. Cannot edit this expense."
          });
          // Don't create a new expense, just show warning
          return;
        }
      }
    } catch (error) {
      console.error('Error loading expense:', error);
      toast({
        title: "Error",
        description: "Failed to load expense. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const calculateSplits = () => {
    const selectedMembers = [...friends, ...groups.flatMap(g => g.members)].filter(u => billData.selectedMemberIds.includes(u.id));
    // Deduplicate
    const uniqueMembers = Array.from(new Map(selectedMembers.map(item => [item.id, item])).values());

    const splits: Record<string, number> = {};
    uniqueMembers.forEach(m => (splits[m.id] = 0));

    billData.items.forEach(item => {
      // Logic duplicated from ReviewScreen for backend payload preparation
      if (item.splitType === 'quantity' && item.quantityAssignments) {
        const totalUnits = (Object.values(item.quantityAssignments) as number[]).reduce((a, b) => a + b, 0);
        if (totalUnits > 0) {
          const unitPrice = item.price / totalUnits;
          (Object.entries(item.quantityAssignments) as [string, number][]).forEach(([mId, units]) => {
            if (splits[mId] !== undefined) splits[mId] += unitPrice * units;
          });
        } else {
          // Fallback
          const share = item.price / item.splitMemberIds.length;
          item.splitMemberIds.forEach(mId => { if (splits[mId] !== undefined) splits[mId] += share; });
        }
      } else {
        const share = item.price / (item.splitMemberIds.length || 1);
        item.splitMemberIds.forEach(mId => {
          if (splits[mId] !== undefined) splits[mId] += share;
        });
      }
    });

    const subtotal = billData.items.reduce((s, i) => s + i.price, 0);
    const overhead = (billData.tax + billData.otherCharges - billData.discount);

    if (subtotal > 0) {
      Object.keys(splits).forEach(mId => {
        const proportion = splits[mId] / subtotal;
        splits[mId] += overhead * proportion;
      });
    } else if (uniqueMembers.length > 0) {
      Object.keys(splits).forEach(mId => {
        splits[mId] += overhead / uniqueMembers.length;
      });
    }

    return { splits, uniqueMembers, totalAmount: subtotal + overhead };
  };

  const handleFinishSplit = async () => {
    const { splits, uniqueMembers, totalAmount } = calculateSplits();
    const isMultiplePayers = billData.payerId === '__multiple__';
    if (isMultiplePayers || (billData.payerShares && Object.keys(billData.payerShares).length > 0)) {
      const sumPaid = Object.values(billData.payerShares || {}).reduce((a, b) => a + b, 0);
      if (Math.abs(sumPaid - totalAmount) >= 0.02) {
        toast({
          title: "Total paid doesn't match bill",
          description: `Total paid is $${sumPaid.toFixed(2)}. It should equal the bill total $${totalAmount.toFixed(2)}.`,
          variant: "destructive"
        });
        return;
      }
      if (isMultiplePayers && (!billData.payerShares || Object.keys(billData.payerShares).length === 0)) {
        toast({
          title: "Enter who paid",
          description: "Select \"Multiple people\" and enter the amount each person paid, or choose a single payer from the dropdown.",
          variant: "destructive"
        });
        return;
      }
    }
    setIsProcessing(true);
    try {

      // Format for Splitwise Service
      // We need to pass all users involved, including the current user (payer)
      // expense-payload.ts logic expects "users" array and "customAmounts" map.

      const payloadUsers = uniqueMembers.map(m => ({
        id: parseInt(m.id), // Splitwise IDs are numbers usually, but our interface uses strings. Ensure safe conversion.
        first_name: m.name.split(' ')[0],
        last_name: m.name.split(' ').slice(1).join(' ')
      }));

      // Ensure currentUser is in the list if not already (for payer logic)
      // Assuming existing service handles "user owes 0/paid full" correctly if passed in users list.

      // Build paid shares: multiple payers from payerShares, or single payer from payerId
      let paidShares: Record<string, number>;
      if (billData.payerShares && Object.keys(billData.payerShares).length > 0) {
        const sumPaid = Object.values(billData.payerShares).reduce((a, b) => a + b, 0);
        if (Math.abs(sumPaid - totalAmount) < 0.02) {
          paidShares = billData.payerShares;
        } else {
          const fallbackPayerId = billData.payerId || authUser?.id || uniqueMembers[0]?.id;
          paidShares = fallbackPayerId ? { [fallbackPayerId]: totalAmount } : {};
        }
      } else {
        const singlePayerId = (billData.payerId && billData.payerId !== '__multiple__') ? billData.payerId : (authUser?.id || uniqueMembers[0]?.id);
        paidShares = singlePayerId ? { [singlePayerId]: totalAmount } : (uniqueMembers[0] ? { [uniqueMembers[0].id]: totalAmount } : {});
      }

      const expenseData = {
        cost: totalAmount,
        description: billData.storeName || "Bill Split",
        group_id: billData.groupId ? parseInt(billData.groupId) : 0,
        split_equally: false,
        date: billData.date, // YYYY-MM-DD — preserve the user-selected expense date
        users: payloadUsers,
        customAmounts: splits,
        paidShares
      };

      const payload = SplitwiseService.formatExpensePayload(expenseData);

      // Track corrections if original extraction exists and user is authenticated
      if (originalExtraction && receiptId && authUser?.id && flow === AppFlow.SCAN) {
        try {
          // Compare original extraction with current billData to detect modifications
          const userModifications: {
            items?: Array<{ name: string; price: number }>;
            taxes?: number;
            otherCharges?: number;
            totalCost?: number;
          } = {};

          // Check for item modifications
          const modifiedItems: Array<{ name: string; price: number }> = [];
          billData.items.forEach((item, index) => {
            const originalItem = originalExtraction.items[index];
            if (originalItem) {
              const nameChanged = originalItem.name !== item.name;
              const priceChanged = Math.abs(originalItem.price - item.price) > 0.01;
              if (nameChanged || priceChanged) {
                modifiedItems.push({
                  name: item.name,
                  price: item.price
                });
              }
            } else {
              // New item added
              modifiedItems.push({
                name: item.name,
                price: item.price
              });
            }
          });

          // Check if items were removed (original had more items)
          if (originalExtraction.items.length > billData.items.length) {
            // Items were removed, include all current items as modifications
            userModifications.items = billData.items.map(item => ({
              name: item.name,
              price: item.price
            }));
          } else if (modifiedItems.length > 0) {
            userModifications.items = modifiedItems;
          }

          // Check for tax modifications
          if (Math.abs((originalExtraction.taxes || 0) - billData.tax) > 0.01) {
            userModifications.taxes = billData.tax;
          }

          // Check for other charges modifications
          if (Math.abs((originalExtraction.otherCharges || 0) - billData.otherCharges) > 0.01) {
            userModifications.otherCharges = billData.otherCharges;
          }

          // Check for total cost modifications
          if (Math.abs(originalExtraction.totalCost - totalAmount) > 0.01) {
            userModifications.totalCost = totalAmount;
          }

          // Only track if there are actual modifications
          if ((userModifications.items && userModifications.items.length > 0) ||
            userModifications.taxes !== undefined ||
            userModifications.otherCharges !== undefined ||
            userModifications.totalCost !== undefined) {
            await AnalyticsClientService.trackCorrections(
              receiptId,
              originalExtraction,
              userModifications
            );
          }
        } catch (error) {
          console.warn('Failed to track corrections:', error);
          // Don't block the flow if correction tracking fails
        }
      }

      const formattedPayload = SplitwiseService.formatExpensePayload(expenseData);

      // Add detailed notes
      formattedPayload.details = billData.notes;

      const splitwiseResponse = await SplitwiseService.createExpense(formattedPayload);
      const splitwiseExpenseId = splitwiseResponse?.expenses?.[0]?.id?.toString() || null;

      if (!splitwiseExpenseId) {
        throw new Error('Splitwise did not return a valid expense ID. The expense may not have been created.');
      }

      // Save or update to database if user is authenticated
      if (authUser?.id) {
        try {
          const selectedGroup = groups.find(g => g.id === billData.groupId);

          if (editingExpenseId) {
            // Update existing expense
            await AnalyticsClientService.updateExpenseHistory({
              id: editingExpenseId,
              storeName: billData.storeName || "Bill Split",
              date: billData.date,
              total: totalAmount,
              source: flow === AppFlow.SCAN ? 'scan' : 'manual',
              groupId: billData.groupId || undefined,
              groupName: selectedGroup?.name || undefined,
              splitwiseExpenseId: splitwiseExpenseId || undefined,
              billData: billData // Save full bill data for editing
            });
          } else {
            // Create new expense
            const savedExpense = await AnalyticsClientService.saveExpenseHistory({
              storeName: billData.storeName || "Bill Split",
              date: billData.date,
              total: totalAmount,
              source: flow === AppFlow.SCAN ? 'scan' : 'manual',
              groupId: billData.groupId || undefined,
              groupName: selectedGroup?.name || undefined,
              splitwiseExpenseId: splitwiseExpenseId || undefined,
              billData: billData // Save full bill data for editing
            });

            if (!savedExpense) {
              console.error('Failed to save expense to database - no data returned');
            } else if (!savedExpense.bill_data) {
              console.warn('Expense saved but bill_data is missing. Expense ID:', savedExpense.id);
            }
          }
        } catch (error) {
          console.error('Failed to save expense to database:', error);
          // Don't block the flow if database save fails, but log the error
        }
      }

      // Save to localStorage as fallback
      const newHistoryItem = {
        id: billData.id,
        storeName: billData.storeName,
        date: billData.date,
        total: totalAmount,
        source: flow
      };

      setHistory(prev => {
        const filtered = prev.filter(h => h.id !== newHistoryItem.id);
        const updated = [newHistoryItem, ...filtered].slice(0, 5);
        localStorage.setItem('bill_splitter_history', JSON.stringify(updated));
        return updated;
      });

      // Refresh analytics after saving expense
      if (authUser?.id) {
        try {
          const expenseCounts = await AnalyticsClientService.getUserExpenseCounts();
          if (expenseCounts) {
            setAnalytics(expenseCounts);
          }
        } catch (error) {
          console.warn('Failed to refresh analytics:', error);
        }
      }

      setEditingExpenseId(null); // Clear editing state after successful save
      setCurrentStep(Step.SUCCESS);
      setSavedFlowState(null);

      // Delete the flow state draft once successfully finished
      if (authUser?.id && billData.id) {
        deleteFlowState(billData.id).catch(() => { });
      }

    } catch (error) {
      console.error("Sync failed", error);
      toast({
        title: "Sync Failed",
        description: "Could not create expense in Splitwise. " + (error as Error).message,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please upload an image smaller than 10MB", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setPreviewImage(base64);
      setIsProcessing(true);

      const extractionStartTime = Date.now();

      try {
        let imageUrl: string | undefined;
        let imageHash: string | undefined;

        // Get signed URLs from API (no file in request — avoids FUNCTION_PAYLOAD_TOO_LARGE), then upload directly to Supabase
        if (authUser?.id) {
          try {
            const hash = await generateImageHash(file);
            const fileExt = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'jpg';

            const payload = { hash, fileExt };
            const urlResponse = await fetch('/api/analytics/upload-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            if (urlResponse.ok) {
              const data = await urlResponse.json();
              imageUrl = data.imageUrl;
              imageHash = data.imageHash;

              // If we got an upload token, upload the file directly to Supabase (file never hits our server)
              if (data.token && data.bucket && data.uploadPath) {
                const { error: uploadError } = await supabase.storage
                  .from(data.bucket)
                  .uploadToSignedUrl(data.uploadPath, data.token, file, { cacheControl: '3600' });

                if (uploadError) {
                  console.warn('Direct upload to Supabase failed, falling back to base64:', uploadError);
                  imageUrl = undefined;
                  imageHash = undefined;
                } else if (data.needsUploadThenGetUrl) {
                  // File didn't exist before; now it does. Get read URL with a second request (no file in body).
                  const readResponse = await fetch('/api/analytics/upload-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  if (readResponse.ok) {
                    const readData = await readResponse.json();
                    if (readData.imageUrl) {
                      imageUrl = readData.imageUrl;
                    }
                  }
                }
              }
              // If no token, file already existed; imageUrl is already the read URL
            } else {
              console.warn('Upload image URLs failed, falling back to base64');
            }
          } catch (error) {
            console.warn('Failed to get upload URLs or upload to Supabase, falling back to base64:', error);
          }
        }

        // Call Server Action to extract receipt data
        // Use imageUrl if available (preferred), otherwise fall back to base64 for non-authenticated users
        const extracted = await extractReceiptData(
          imageUrl ? { imageUrl } : { photoDataUri: base64 }
        );
        const processingTimeMs = Date.now() - extractionStartTime;

        // Store original extraction for correction tracking
        const originalExtractionData = {
          storeName: extracted.storeName || '',
          date: extracted.date,
          items: extracted.items.map(item => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1
          })),
          totalCost: extracted.totalCost,
          taxes: extracted.taxes || 0,
          otherCharges: extracted.otherCharges || 0,
          discount: extracted.discount || 0,
          discrepancyFlag: extracted.discrepancyFlag || false
        };
        setOriginalExtraction(originalExtractionData);

        // Update bill data
        setBillData(prev => ({
          ...prev,
          storeName: extracted.storeName || 'New Expense',
          date: extracted.date || new Date().toLocaleDateString('en-CA'),
          tax: extracted.taxes || 0,
          total: extracted.totalCost || 0,
          items: extracted.items.map(item => ({
            id: Math.random().toString(36).substr(2, 9),
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1,
            splitType: 'equally',
            splitMemberIds: prev.selectedMemberIds.length > 0 ? prev.selectedMemberIds : [], // Don't have members yet usually
          })),
          otherCharges: extracted.otherCharges || 0,
          discount: extracted.discount || 0,
          source: AppFlow.SCAN
        }));

        // Track receipt processing if user is authenticated and image was uploaded
        if (authUser?.id && imageUrl) {
          try {
            // Track receipt processing with the uploaded image URL
            const trackedReceiptId = await AnalyticsClientService.trackReceiptProcessing({
              aiExtraction: originalExtractionData,
              processingTimeMs,
              aiModelVersion: extracted.aiMetadata?.modelName || 'unknown',
              aiProvider: extracted.aiMetadata?.provider,
              aiModelName: extracted.aiMetadata?.modelName,
              aiTokensUsed: extracted.aiMetadata?.tokensUsed,
              aiProcessingTimeMs: extracted.aiMetadata?.processingTimeMs,
              existingImageUrl: imageUrl,
              existingImageHash: imageHash,
              originalFilename: file.name,
              fileSize: file.size
            });

            if (trackedReceiptId) {
              setReceiptId(trackedReceiptId);
            }
          } catch (error) {
            console.warn('Failed to track receipt processing:', error);
            // Don't block the flow if tracking fails
          }
        }

        setCurrentStep(Step.GROUP_SELECTION);
        setShowFeedback(true);
      } catch (err) {
        console.error("Extraction error:", err);
        toast({
          title: "Scan Failed",
          description: "Could not automatically read receipt. Switching to manual entry.",
          variant: "destructive"
        });
        setBillData(prev => ({ ...prev, source: AppFlow.SCAN })); // Keep scan source but empty data
        setCurrentStep(Step.GROUP_SELECTION);
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFeedback = async (type: 'accurate' | 'needs_fix') => {
    if (receiptId && authUser?.id) {
      try {
        await AnalyticsClientService.submitFeedback({
          receiptId,
          feedback: {
            overall_accuracy: type === 'accurate' ? 'thumbs_up' : 'thumbs_down',
            additional_notes: type === 'accurate' ? 'Receipt extraction was accurate' : 'Receipt extraction needs improvement'
          }
        });
      } catch (error) {
        console.warn('Failed to submit feedback:', error);
        // Don't block the flow if feedback submission fails
      }
    }
    setShowFeedback(false);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  // Combined list of all available users for selection components
  const allUsers = [
    ...(authUser ? [authUser] : []),
    ...friends,
    ...groups.flatMap(g => g.members)
  ];
  // Deduplicate for passing to components
  const uniqueAllUsers = Array.from(new Map(allUsers.map(item => [item.id, item])).values());

  // Analytics are now loaded from database in useEffect above

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------

  if (isAuthLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Logo className="w-20 h-20" />
      </div>
    );
  }

  // If not authenticated, the Layout header handles login button, or we can show a splash here
  // But ideally useAuth ensures we have user eventually or redirect.
  // For this design, let's show the Splash if no auth, mimicking App.tsx
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 animate-fade-in">
        <div className="flex flex-col items-center text-center max-w-xs">
          <div className="mb-4 transition-transform duration-1000">
            <Logo className="w-32 h-32" />
          </div>
          <div className="mb-10">
            <h1 className="text-5xl md:text-6xl font-black tracking-tight text-foreground mb-6">
              <span className="font-black">Split</span><span className="bg-clip-text text-transparent bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700">Scan</span>
            </h1>
            <div className="flex items-center justify-center gap-4">
              <div className="h-[1px] w-6 bg-border"></div>
              <p className="text-muted-foreground font-bold uppercase tracking-[0.4em] text-[10px] whitespace-nowrap">
                Splitting made intelligent
              </p>
              <div className="h-[1px] w-6 bg-border"></div>
            </div>
          </div>
          <button
            onClick={handleLogin}
            className="w-full py-5 px-8 bg-splitwise text-white rounded-[2.5rem] font-black text-base shadow-xl shadow-emerald-200/40 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-3"
          >
            <SplitwiseLogoIcon className="h-5 w-5" />
            Join with Splitwise
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-md mx-auto bg-background flex flex-col relative pb-32">
      <StepProgress
        currentStep={currentStep}
        onHomeClick={handleGoHome}
      />

      {/* Profile Overlay */}
      <ProfileOverlay
        isOpen={showProfile}
        onClose={() => setShowProfile(false)}
        user={authUser}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onLogout={logout}
        onAdminClick={isAdmin ? () => setShowAdmin(true) : undefined}
      />

      {/* Feedback Overlay */}
      <FeedbackOverlay isOpen={showFeedback} onFeedback={handleFeedback} />

      <main className="flex-1 overflow-x-hidden">
        {showAdmin && isAdmin ? (
          <div className="p-6">
            <AdminPanel history={history} onBack={() => setShowAdmin(false)} />
          </div>
        ) : (
          <>
            {currentStep === Step.FLOW_SELECTION && (
              <DashboardView
                user={authUser}
                greeting={getGreeting()}
                analytics={analytics}
                history={history}
                onProfileClick={() => setShowProfile(true)}
                onScanClick={() => {
                  setFlow(AppFlow.SCAN);
                  setCurrentStep(Step.UPLOAD);
                  setPreviewImage(null);
                  setBillData({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9) });
                  setOriginalExtraction(null);
                  setReceiptId(null);
                  setEditingExpenseId(null);
                }}
                onManualClick={() => {
                  setFlow(AppFlow.MANUAL);
                  setBillData({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9), source: AppFlow.MANUAL });
                  setCurrentStep(Step.GROUP_SELECTION);
                  setOriginalExtraction(null);
                  setReceiptId(null);
                  setEditingExpenseId(null); // Clear editing state
                }}
                onHistoryItemClick={handleEditHistorical}
                drafts={drafts}
                savedFlowState={savedFlowState}
                onDraftClick={handleResumeFromDraft}
                onDeleteDraft={handleDeleteDraft}
                onResumeClick={handleResumeFromSaved}
                onDismissResume={handleDismissResume}
              />
            )}

            {/* Removed Floating Pill */}

            {currentStep === Step.UPLOAD && (
              <div className="flex flex-col items-center gap-8 p-8 animate-slide-up h-full">
                <div className="text-center">
                  <h2 className="text-3xl font-black text-foreground">Digitize Bill</h2>
                  <p className="text-sm font-medium text-muted-foreground mt-2">AI will extract items automatically</p>
                </div>

                <div className="w-full max-w-sm aspect-[4/5] bg-card border-2 border-dashed border-border rounded-[3rem] flex flex-col items-center justify-center relative overflow-hidden group shadow-2xl transition-all">
                  {isProcessing && <div className="scanner-line"></div>}

                  {previewImage ? (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 relative">
                      {isProcessing && (
                        <div className="absolute inset-0 z-10 pointer-events-none opacity-30 mix-blend-overlay"
                          style={{ backgroundImage: `radial-gradient(hsl(var(--primary)) 1px, transparent 1px)`, backgroundSize: '15px 15px' }}></div>
                      )}

                      <img src={previewImage} className={`max-w-full max-h-full object-contain rounded-2xl transition-all duration-1000 ${isProcessing ? 'opacity-40 blur-[3px] scale-95 brightness-50' : 'opacity-100'}`} />

                      {isProcessing && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-30">
                          <div className="relative">
                            <Logo className="w-24 h-24 animate-pulse" />
                            <div className="absolute inset-0 rounded-full bg-primary/30 blur-2xl animate-pulse"></div>
                          </div>
                          <div className="bg-background/95 backdrop-blur-xl px-10 py-3 rounded-full shadow-2xl border border-primary/20">
                            <p className="font-black text-primary uppercase tracking-[0.4em] text-[10px] animate-pulse">Analyzing...</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="flex flex-col items-center cursor-pointer p-12 text-center w-full h-full justify-center">
                      <div className="w-24 h-24 bg-primary/10 rounded-[2.5rem] flex items-center justify-center text-primary mb-6 transition-transform group-hover:scale-110 shadow-inner">
                        <i className="fas fa-file-invoice-dollar text-4xl"></i>
                      </div>
                      <span className="font-black text-foreground text-xl">Upload Receipt</span>
                      <p className="text-xs text-muted-foreground font-bold mt-2 uppercase tracking-widest max-w-[150px]">Supports Images & PDF</p>
                      <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileSelect} />
                    </label>
                  )}
                </div>
              </div>
            )}

            {currentStep === Step.GROUP_SELECTION && (
              <div className="p-8 animate-slide-up">
                <GroupSelector
                  selectedGroupId={billData.groupId}
                  selectedMemberIds={billData.selectedMemberIds}
                  onChange={(g, m) => setBillData(prev => ({ ...prev, groupId: g, selectedMemberIds: m }))}
                  groups={groups}
                  friends={uniqueAllUsers}
                />
              </div>
            )}

            {currentStep === Step.ITEM_SPLITTING && (
              <div className="p-8 animate-slide-up">
                <ItemSplitter
                  items={billData.items}
                  selectedMembers={uniqueAllUsers.filter(u => billData.selectedMemberIds.includes(u.id))}
                  tax={billData.tax}
                  discount={billData.discount}
                  otherCharges={billData.otherCharges}
                  flow={flow}
                  onChange={(items, tax, discount, other) => setBillData(prev => ({ ...prev, items, tax, discount, otherCharges: other }))}
                />
              </div>
            )}

            {currentStep === Step.REVIEW && (
              <div className="p-8 animate-slide-up">
                <ReviewScreen
                  billData={billData}
                  onUpdate={(updates) => setBillData(prev => ({ ...prev, ...updates }))}
                  members={uniqueAllUsers}
                  groups={groups}
                  authUserId={authUser?.id}
                />
              </div>
            )}

            {currentStep === Step.SUCCESS && (
              <div className="fixed inset-0 bg-background z-50 flex flex-col items-center justify-center p-12">
                <div className="w-28 h-28 bg-emerald-500/10 rounded-[2.5rem] flex items-center justify-center text-emerald-500 text-5xl mb-8 relative">
                  <i className="fas fa-check"></i>
                  <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping"></div>
                </div>
                <h2 className="text-4xl font-black text-foreground tracking-tight">Split Synced!</h2>
                <p className="text-center text-muted-foreground mt-4 max-w-[240px]">Expenses and group balances have been updated in Splitwise.</p>
                <button onClick={startNewSplit} className="mt-14 w-full py-5 bg-primary text-primary-foreground rounded-[2.5rem] font-black text-lg shadow-xl shadow-primary/20 active:scale-95 transition-transform">Start New Split</button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer Navigation */}
      {currentStep > Step.FLOW_SELECTION && currentStep < Step.SUCCESS && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-background border-t border-border p-6 safe-bottom flex gap-4 z-40 shadow-[0_-20px_40px_rgba(0,0,0,0.12)]">
          <button
            disabled={isProcessing}
            onClick={() => {
              // If editing an expense, cancel edit and return to dashboard
              if (editingExpenseId) {
                cancelEdit();
                return;
              }
              // Discard expense and go home: permanently delete the draft
              if (currentStep === Step.UPLOAD || (currentStep === Step.GROUP_SELECTION && flow === AppFlow.MANUAL)) {
                discardExpenseAndGoHome();
                return;
              }
              // From group selection (scan flow): going back to upload — clear image so user can start a fresh scan
              if (currentStep === Step.GROUP_SELECTION && flow === AppFlow.SCAN) {
                setPreviewImage(null);
                setBillData({ ...DEFAULT_BILL, id: Math.random().toString(36).substr(2, 9) });
                setOriginalExtraction(null);
                setReceiptId(null);
              }
              setCurrentStep(prev => prev - 1);
            }}
            style={{ outline: 'none', boxShadow: 'none', WebkitTapHighlightColor: 'transparent' }}
            className="flex-1 py-4 bg-muted text-muted-foreground font-bold rounded-[2.5rem] disabled:opacity-50 transition-all active:scale-95 focus:outline-none focus:ring-0"
          >
            {editingExpenseId ? 'Cancel' : (currentStep === Step.UPLOAD || (currentStep === Step.GROUP_SELECTION && flow === AppFlow.MANUAL)) ? 'Discard' : 'Back'}
          </button>
          <button
            disabled={isProcessing || (currentStep === Step.UPLOAD && !previewImage) || (currentStep === Step.GROUP_SELECTION && billData.selectedMemberIds.length === 0)}
            onClick={() => {
              if (currentStep === Step.REVIEW) {
                handleFinishSplit();
              } else if (currentStep === Step.GROUP_SELECTION) {
                // When moving to item splitting, ensure all items are assigned to all selected members by default
                setBillData(prev => ({
                  ...prev,
                  items: prev.items.map(item => ({
                    ...item,
                    splitMemberIds: prev.selectedMemberIds
                  }))
                }));
                setCurrentStep(prev => prev + 1);
              } else {
                setCurrentStep(prev => prev + 1);
              }
            }}
            style={{ outline: 'none', boxShadow: 'none', WebkitTapHighlightColor: 'transparent' }}
            className="flex-[2] py-4 bg-primary text-primary-foreground rounded-[2.5rem] font-black shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 focus:outline-none focus:ring-0"
          >
            {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
            {currentStep === Step.REVIEW ? 'Sync & Finish' : 'Continue'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function BillSplitterPage() {
  return <BillSplitterFlow />;
}
