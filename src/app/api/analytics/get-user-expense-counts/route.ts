import { getAuthenticatedUser } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = getSupabaseClient();

        // Get all expenses for the user to calculate counts
        const { data, error } = await supabase
            .from('expense_history')
            .select('source, total, date, created_at')
            .eq('user_id', user.userId);

        if (error) {
            console.error('Error fetching expense counts:', error);
            return NextResponse.json(
                { error: 'Failed to fetch expense counts' },
                { status: 500 }
            );
        }

        // Calculate counts and volumes (source can be 'scan'/'manual' or 'SCAN'/'MANUAL')
        const norm = (s: string) => (s || '').toLowerCase();
        const scanCount = data?.filter(e => norm(e.source) === 'scan').length || 0;
        const manualCount = data?.filter(e => norm(e.source) === 'manual').length || 0;
        const totalVolume = data?.reduce((sum, e) => sum + (Number(e.total) || 0), 0) || 0;

        // Monthly volume: expenses created/synced this month (created_at is most reliable)
        const now = new Date();
        const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthlyVolume = data?.filter(e => {
            const ts = e.created_at ?? e.date;
            if (!ts) return false;
            return String(ts).substring(0, 7) === currentMonthStr;
        }).reduce((sum, e) => sum + (Number(e.total) || 0), 0) || 0;

        return NextResponse.json({
            success: true,
            data: {
                scanCount,
                manualCount,
                totalVolume,
                monthlyVolume
            }
        });
    } catch (error) {
        console.error('Error in get-user-expense-counts GET:', error);
        return NextResponse.json(
            { error: 'Failed to fetch expense counts' },
            { status: 500 }
        );
    }
}
