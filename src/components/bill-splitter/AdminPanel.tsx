"use client";

import React, { useState, useEffect } from 'react';
import { BillData } from '@/types';
import { AnalyticsClientService } from '@/services/analytics-client';
import { Loader2, X, Shield, TrendingUp, Users, MessageSquare, LifeBuoy, ArrowLeft, Clock, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';
import { Logo } from '@/components/icons/logo';
import { UserAnalytics } from '@/types/analytics';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface AdminPanelProps {
  history: BillData[];
  onBack: () => void;
}

interface FeedbackLog {
  id: string;
  receiptId: string;
  userId: string;
  userName: string;
  storeName: string;
  type: 'accurate' | 'needs_fix';
  timestamp: string;
  feedback?: any;
}

interface User {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  avatar: string;
  status: 'active' | 'inactive';
  joinedDate: string;
  total_receipts_processed: number;
  last_signin: string;
}

const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ history, onBack }) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'feedback' | 'support'>('stats');
  const [feedbackLogs, setFeedbackLogs] = useState<FeedbackLog[]>([]);
  const [supportRequests, setSupportRequests] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userAnalytics, setUserAnalytics] = useState<UserAnalytics | null>(null);
  const [isLoadingUserAnalytics, setIsLoadingUserAnalytics] = useState(false);
  const [stats, setStats] = useState({
    totalVolume: 0,
    totalScans: 0,
    activeUsers: 0,
    accuracyRate: 0,
    totalUsers: 0,
    totalReceipts: 0,
    totalCorrections: 0,
    averageAccuracy: 0,
    correctionRate: 0,
    manualExpenses: 0,
    ocrScans: 0
  });
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadAdminData = async () => {
      setIsLoading(true);
      try {
        // Load aggregated analytics with date range
        const aggregatedData = await AnalyticsClientService.getAggregatedAnalytics(dateRange);

        // Load feedback logs
        const feedbackResponse = await fetch('/api/analytics/get-feedback-logs?limit=50');
        const feedbackData = await feedbackResponse.json();

        // Load support requests
        const supportResponse = await fetch('/api/analytics/get-support-requests?limit=50');
        const supportData = await supportResponse.json();

        // Load users
        const usersResponse = await fetch('/api/analytics/get-all-users');
        const usersData = await usersResponse.json();

        // All metrics are now filtered by date range from the API
        const totalVolume = aggregatedData?.total_volume || 0;
        const totalReceiptsProcessed = aggregatedData?.total_receipts_processed || 0;
        const totalCorrectionsMade = aggregatedData?.total_corrections_made || 0;
        const averageAccuracy = aggregatedData?.average_accuracy_rating || 0;
        const accuracyRate = aggregatedData?.accuracy_rate || 0;
        const correctionRate = totalReceiptsProcessed > 0
          ? Math.round((totalCorrectionsMade / totalReceiptsProcessed) * 100)
          : 0;

        const feedbackLogsData = feedbackData.success ? feedbackData.data : [];

        setStats({
          totalVolume,
          totalScans: totalReceiptsProcessed, // Total scans = total receipts processed
          activeUsers: aggregatedData?.active_users_last_30_days || 0, // Filtered by date range
          accuracyRate, // Filtered by date range from API
          totalUsers: aggregatedData?.total_users || 0, // Total users (not filtered)
          totalReceipts: totalReceiptsProcessed, // Filtered by date range
          totalCorrections: totalCorrectionsMade, // Filtered by date range
          averageAccuracy: Math.round(averageAccuracy), // Filtered by date range
          correctionRate, // Calculated from filtered data
          manualExpenses: aggregatedData?.manual_expenses_count || 0, // Filtered by date range
          ocrScans: aggregatedData?.ocr_scans_count || 0 // Filtered by date range
        });

        setFeedbackLogs(feedbackLogsData);
        setSupportRequests(supportData.success ? supportData.data : []);

        // Format users
        const formattedUsers: User[] = (usersData.success ? usersData.data : []).map((u: any) => {
          // Handle user_profile - it might be a JSONB object or string
          let profile: any = {};
          if (u.user_profile) {
            try {
              profile = typeof u.user_profile === 'string' ? JSON.parse(u.user_profile) : u.user_profile;
            } catch (e) {
              profile = {};
            }
          }

          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const lastSignin = new Date(u.last_signin);
          const isActive = lastSignin >= thirtyDaysAgo;

          // Build name
          const firstName = profile.first_name || '';
          const lastName = profile.last_name || '';
          const fullName = firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || profile.email || `User ${u.user_id}`;

          // Build avatar URL with proper fallback
          let avatarUrl = profile.profile_picture_url;
          if (!avatarUrl || avatarUrl === 'null' || avatarUrl === 'undefined') {
            // Use first name, last name, or email for avatar generation
            const avatarName = firstName || lastName || profile.email?.split('@')[0] || 'U';
            avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random&size=128`;
          }

          return {
            id: u.id,
            user_id: u.user_id,
            name: fullName,
            email: profile.email,
            avatar: avatarUrl,
            status: isActive ? 'active' : 'inactive',
            joinedDate: new Date(u.first_signin).toLocaleDateString(),
            total_receipts_processed: u.total_receipts_processed || 0,
            last_signin: u.last_signin
          };
        });

        setUsers(formattedUsers);
      } catch (error) {
        console.error('Error loading admin data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAdminData();
  }, [history, dateRange]);

  const loadUserAnalytics = async (userId: string) => {
    setIsLoadingUserAnalytics(true);
    try {
      const analytics = await AnalyticsClientService.getUserAnalytics(userId);
      setUserAnalytics(analytics);
    } catch (error) {
      console.error('Error loading user analytics:', error);
    } finally {
      setIsLoadingUserAnalytics(false);
    }
  };

  const handleStatusChange = async (requestId: string, newStatus: 'open' | 'in_progress' | 'resolved' | 'closed') => {
    try {
      const response = await fetch('/api/analytics/update-support-status', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: requestId, status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      // Update the local state
      setSupportRequests((prev) =>
        prev.map((request) =>
          request.id === requestId
            ? { ...request, status: newStatus, updated_at: new Date().toISOString() }
            : request
        )
      );
    } catch (error) {
      console.error('Error updating support request status:', error);
      // Optionally show a toast notification here
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-slide-up pb-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-foreground tracking-tight">Admin Console</h2>
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">System Overview</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`relative z-50 transition-all duration-200 ${activeTab === 'stats' ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}>
            <button
              onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-card text-card-foreground rounded-xl border border-border shadow-sm text-[10px] font-black uppercase tracking-widest hover:border-primary/20 transition-all active:scale-95"
            >
              <Clock className="w-3 h-3 text-primary" />
              <span>{dateRange === 'all' ? 'All Time' : dateRange.toUpperCase()}</span>
              <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${isDateDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDateDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsDateDropdownOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-32 bg-card text-card-foreground rounded-2xl shadow-xl border border-border p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                  {(['7d', '30d', '90d', 'all'] as const).map((range) => (
                    <button
                      key={range}
                      onClick={() => {
                        setDateRange(range);
                        setIsDateDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors ${dateRange === range
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted'
                        }`}
                    >
                      {range === 'all' ? 'All Time' : range.toUpperCase()}
                      {dateRange === range && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onBack}
            className="!w-10 !h-10 !min-h-0 !p-0 rounded-full bg-card text-card-foreground border border-border shadow-sm flex items-center justify-center hover:bg-muted transition-all active:scale-90"
            aria-label="Close admin panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Admin Tabs */}
      <div className="flex p-1.5 bg-muted rounded-2xl mb-4">
        {(['stats', 'users', 'feedback', 'support'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{ WebkitTapHighlightColor: 'transparent', outline: 'none', boxShadow: 'none' }}
            className={`flex-1 !py-2 !min-h-0 !px-2 text-[10px] font-bold rounded-xl transition-all focus:outline-none focus:ring-0 outline-none ring-0 h-auto uppercase tracking-widest flex items-center justify-center gap-2 ${activeTab === tab
              ? 'bg-card text-primary shadow-sm'
              : 'text-muted-foreground'
              }`}
          >
            {tab === 'stats' && <TrendingUp className="w-3 h-3" />}
            {tab === 'users' && <Users className="w-3 h-3" />}
            {tab === 'feedback' && <MessageSquare className="w-3 h-3" />}
            {tab === 'support' && <LifeBuoy className="w-3 h-3" />}
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'stats' && (
        <>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <Logo className="w-16 h-16 animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading stats...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Total Volume</p>
                <p className="text-2xl font-black tracking-tighter">
                  ${stats.totalVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Total Users</p>
                <p className="text-2xl font-black tracking-tighter">
                  {stats.totalUsers}
                </p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Accuracy Rate</p>
                <p className="text-2xl font-black text-emerald-500 tracking-tighter">{stats.accuracyRate}%</p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Total Receipts</p>
                <p className="text-2xl font-black text-primary tracking-tighter">
                  {stats.totalReceipts}
                </p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Active Users</p>
                <p className="text-2xl font-black text-primary tracking-tighter">
                  {stats.activeUsers}
                </p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">OCR Scans</p>
                <p className="text-2xl font-black text-emerald-500 tracking-tighter">
                  {stats.ocrScans}
                </p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Manual Expenses</p>
                <p className="text-2xl font-black text-purple-500 tracking-tighter">
                  {stats.manualExpenses}
                </p>
              </div>
              <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Corrections</p>
                <p className="text-2xl font-black text-amber-500 tracking-tighter">
                  {stats.totalCorrections}
                </p>
                {stats.correctionRate > 0 && (
                  <p className="text-[9px] font-bold text-muted-foreground mt-1">{stats.correctionRate}% rate</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'users' && selectedUser ? (
        <div className="space-y-6 animate-slide-up">
          {/* User Detail Header */}
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => {
                setSelectedUser(null);
                setUserAnalytics(null);
              }}
              className="!w-10 !h-10 !min-h-0 !p-0 rounded-full bg-muted text-muted-foreground hover:bg-accent transition-all active:scale-90"
              aria-label="Back to users list"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-4">
              <img
                src={selectedUser.avatar}
                className="w-12 h-12 rounded-xl object-cover"
                alt={selectedUser.name}
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  const name = selectedUser.name?.charAt(0) || 'U';
                  target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&size=128`;
                }}
              />
              <div>
                <h3 className="text-lg font-black text-foreground">{selectedUser.name}</h3>
                <p className="text-xs text-muted-foreground">{selectedUser.email || `User ID: ${selectedUser.user_id}`}</p>
              </div>
            </div>
          </div>

          {/* User Analytics */}
          {isLoadingUserAnalytics ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <Logo className="w-16 h-16 animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading analytics...</p>
            </div>
          ) : userAnalytics ? (
            <div className="space-y-4">
              {/* Basic Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Receipts Processed</p>
                  <p className="text-2xl font-black tracking-tighter">
                    {userAnalytics.total_receipts_processed || 0}
                  </p>
                </div>
                <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Corrections Made</p>
                  <p className="text-2xl font-black text-amber-500 tracking-tighter">
                    {userAnalytics.total_corrections_made || 0}
                  </p>
                </div>
                <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Accuracy Rating</p>
                  <p className="text-2xl font-black text-emerald-500 tracking-tighter">
                    {userAnalytics.average_accuracy_rating ? `${Math.round(userAnalytics.average_accuracy_rating)}%` : 'N/A'}
                  </p>
                </div>
                <div className="bg-card text-card-foreground p-6 rounded-[2.5rem] border border-border shadow-sm">
                  <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Total Sessions</p>
                  <p className="text-2xl font-black text-primary tracking-tighter">
                    {userAnalytics.total_sessions || 0}
                  </p>
                </div>
              </div>

              {/* Activity Info */}
              <div className="bg-card text-card-foreground rounded-[2.5rem] border border-border p-6 shadow-sm">
                <h4 className="text-sm font-black text-foreground mb-4 uppercase tracking-wider">Activity</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="text-xs font-bold text-muted-foreground uppercase">First Signin</p>
                      <p className="text-sm font-bold">
                        {new Date(userAnalytics.first_signin).toLocaleDateString()} {new Date(userAnalytics.first_signin).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    <div className="flex-1">
                      <p className="text-xs font-bold text-muted-foreground uppercase">Last Signin</p>
                      <p className="text-sm font-bold">
                        {new Date(userAnalytics.last_signin).toLocaleDateString()} {new Date(userAnalytics.last_signin).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Performance Metrics */}
              {userAnalytics.performance_metrics && (
                <div className="bg-card text-card-foreground rounded-[2.5rem] border border-border p-6 shadow-sm">
                  <h4 className="text-sm font-black text-foreground mb-4 uppercase tracking-wider">Performance</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Avg Processing Time</p>
                      <p className="text-lg font-black">
                        {Math.round(userAnalytics.performance_metrics.average_processing_time_ms || 0)}ms
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Fastest</p>
                      <p className="text-lg font-black text-emerald-500">
                        {userAnalytics.performance_metrics.fastest_processing_time_ms || 0}ms
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Feedback Metrics */}
              {userAnalytics.feedback_metrics && (
                <div className="bg-card text-card-foreground rounded-[2.5rem] border border-border p-6 shadow-sm">
                  <h4 className="text-sm font-black text-foreground mb-4 uppercase tracking-wider">Feedback</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Total Feedback</p>
                      <p className="text-lg font-black">
                        {userAnalytics.feedback_metrics.total_feedback_submitted || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-muted-foreground uppercase mb-1">Thumbs Up</p>
                      <p className="text-lg font-black text-emerald-500">
                        {userAnalytics.feedback_metrics.thumbs_up_count || 0}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center bg-muted/50 rounded-[2.5rem] border-2 border-dashed border-border">
              <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">No analytics data available</p>
            </div>
          )}
        </div>
      ) : activeTab === 'users' && (
        <>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <Logo className="w-16 h-16 animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading users...</p>
            </div>
          ) : (
            <div className="bg-card text-card-foreground rounded-[2.5rem] border border-border overflow-hidden shadow-sm">
              {users.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">No users yet</p>
                </div>
              ) : (
                users.map((user) => (
                  <div
                    key={user.id}
                    className="p-5 flex items-center justify-between border-b border-border last:border-none cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => {
                      setSelectedUser(user);
                      loadUserAnalytics(user.user_id);
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <img
                        src={user.avatar}
                        className="w-10 h-10 rounded-xl object-cover"
                        alt={user.name}
                        onError={(e) => {
                          // Fallback if image fails to load
                          const target = e.target as HTMLImageElement;
                          const name = user.name?.charAt(0) || 'U';
                          target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&size=128`;
                        }}
                      />
                      <div>
                        <p className="text-sm font-bold leading-tight">{user.name}</p>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter mt-0.5">
                          Joined: {user.joinedDate} • {user.total_receipts_processed} receipts
                        </p>
                        <p className="text-[9px] font-bold text-primary/70 uppercase tracking-tighter mt-0.5">
                          Last active: {formatRelativeTime(user.last_signin)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase ${user.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-muted text-muted-foreground'
                        }`}>
                        {user.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'feedback' && (
        <>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <Logo className="w-16 h-16 animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading feedback...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {feedbackLogs.length === 0 ? (
                <div className="p-12 text-center bg-muted/50 rounded-[2.5rem] border-2 border-dashed border-border">
                  <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">No feedback logs yet</p>
                </div>
              ) : (
                <div className="bg-card text-card-foreground rounded-[2.5rem] border border-border overflow-hidden shadow-sm">
                  {feedbackLogs.map((log) => (
                    <div key={log.id} className="p-5 flex items-center justify-between border-b border-border last:border-none">
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${log.type === 'accurate'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-destructive/10 text-destructive'
                          }`}>
                          {log.type === 'accurate' ? '✓' : '✗'}
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-tight">{log.storeName}</p>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter mt-1">
                            {log.userName} • {new Date(log.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'support' && (
        <>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <Logo className="w-16 h-16 animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading support requests...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {supportRequests.length === 0 ? (
                <div className="p-12 text-center bg-muted/50 rounded-[2.5rem] border-2 border-dashed border-border">
                  <LifeBuoy className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">No support requests yet</p>
                </div>
              ) : (
                <div className="bg-card text-card-foreground rounded-[2.5rem] border border-border overflow-hidden shadow-sm">
                  {supportRequests.map((request) => (
                    <div key={request.id} className="p-5 border-b border-border last:border-none">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase ${request.type === 'bug'
                            ? 'bg-destructive/10 text-destructive'
                            : request.type === 'feature'
                            ? 'bg-blue-500/10 text-blue-500'
                            : request.type === 'support'
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-muted text-muted-foreground'
                            }`}>
                            {request.type}
                          </div>
                          <Select
                            value={request.status}
                            onValueChange={(value) => handleStatusChange(request.id, value as 'open' | 'in_progress' | 'resolved' | 'closed')}
                          >
                            <SelectTrigger className={`!w-auto !h-auto !min-h-0 !px-2 !py-1 rounded-lg text-[8px] font-black uppercase border-none outline-none cursor-pointer transition-colors focus:ring-0 focus:ring-offset-0 [&>svg]:text-current [&>svg]:!w-2.5 [&>svg]:!h-2.5 [&>*:last-child]:!w-2.5 [&>*:last-child]:!h-2.5 [&>*:last-child>svg]:!w-2.5 [&>*:last-child>svg]:!h-2.5 ${request.status === 'open'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                              : request.status === 'in_progress'
                              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
                              : request.status === 'resolved'
                              ? 'bg-muted text-muted-foreground hover:bg-accent'
                              : 'bg-muted text-muted-foreground hover:bg-accent'
                              }`}>
                              <SelectValue className="text-[8px] font-black uppercase text-current" />
                            </SelectTrigger>
                            <SelectContent className="bg-card text-card-foreground border-border">
                              <SelectItem value="open" className="text-[8px] font-black uppercase focus:bg-accent">Open</SelectItem>
                              <SelectItem value="in_progress" className="text-[8px] font-black uppercase focus:bg-accent">In Progress</SelectItem>
                              <SelectItem value="resolved" className="text-[8px] font-black uppercase focus:bg-accent">Resolved</SelectItem>
                              <SelectItem value="closed" className="text-[8px] font-black uppercase focus:bg-accent">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">
                          {new Date(request.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <p className="text-sm font-bold mb-2">{request.message}</p>
                      {(request.user_name || request.user_email) && (
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">
                          {request.user_name || request.user_email}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

