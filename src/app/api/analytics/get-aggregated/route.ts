import { UserTrackingService } from '@/services/user-tracking';
import { NextResponse, NextRequest } from 'next/server';
import { AdminAuth } from '@/lib/admin-auth';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Require admin access
        await AdminAuth.requireAdmin();

        const { searchParams } = new URL(request.url);
        const days = searchParams.get('days') || undefined;

        const supabase = getSupabaseClient();

        // Calculate date range filter
        let startDate: Date | null = null;
        if (days && days !== 'all') {
            const numDays = parseInt(days.replace('d', ''));
            if (!isNaN(numDays)) {
                startDate = new Date();
                startDate.setDate(startDate.getDate() - numDays);
            }
        }

        // 1. Get Aggregated Analytics from UserTrackingService (for total_users and active_users)
        const aggregatedData = await UserTrackingService.getAggregatedAnalytics(days);

        // 2. Calculate REAL Total Volume, Manual, and OCR from expense_history with filter
        let expenseQuery = supabase.from('expense_history').select('total, source, date, created_at');

        if (startDate) {
            // Include expenses exactly on the start date
            const formattedStartDate = startDate.toISOString();
            expenseQuery = expenseQuery.gte('created_at', formattedStartDate);
        }

        const { data: expenseData, error: expenseError } = await expenseQuery;

        let realTotalVolume = 0;
        let manualCount = 0;
        let scanCount = 0;
        
        if (!expenseError && expenseData) {
            const norm = (s: string) => (s || '').toLowerCase();
            realTotalVolume = expenseData.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
            // Count by source
            expenseData.forEach((item: any) => {
                if (norm(item.source) === 'manual') {
                    manualCount++;
                } else if (norm(item.source) === 'scan') {
                    scanCount++;
                }
            });
        }

        // 3. Calculate Total Receipts Processed from expense_history (all expenses = scan + manual)
        // This is already calculated from expenseData, so we can use the count
        const totalReceiptsProcessed = expenseData?.length || 0;

        // 4. Calculate Total Corrections from correction_patterns with filter
        let correctionsQuery = supabase.from('correction_patterns').select('id', { count: 'exact', head: false });

        if (startDate) {
            correctionsQuery = correctionsQuery.gte('created_at', startDate.toISOString());
        }

        const { count: totalCorrectionsMade } = await correctionsQuery;

        // 5. Calculate Accuracy Rate from feedback in receipt_processing_history with filter
        let feedbackQuery = supabase
            .from('receipt_processing_history')
            .select('feedback')
            .not('feedback', 'is', null);

        if (startDate) {
            feedbackQuery = feedbackQuery.gte('created_at', startDate.toISOString());
        }

        const { data: feedbackData } = await feedbackQuery;
        
        let accuracyRate = 0;
        if (feedbackData && feedbackData.length > 0) {
            const accurateCount = feedbackData.filter((item: any) => 
                item.feedback?.overall_accuracy === 'thumbs_up'
            ).length;
            accuracyRate = Math.round((accurateCount / feedbackData.length) * 100);
        }

        // 6. Calculate Average Accuracy Rating from feedback in date range
        let averageAccuracy = 0;
        if (feedbackData && feedbackData.length > 0) {
            const ratings: number[] = [];
            feedbackData.forEach((item: any) => {
                const feedback = item.feedback;
                if (feedback?.item_extraction_accuracy) ratings.push(feedback.item_extraction_accuracy);
                if (feedback?.price_extraction_accuracy) ratings.push(feedback.price_extraction_accuracy);
                if (feedback?.tax_extraction_accuracy) ratings.push(feedback.tax_extraction_accuracy);
            });
            if (ratings.length > 0) {
                averageAccuracy = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                ...aggregatedData,
                total_volume: realTotalVolume,
                manual_expenses_count: manualCount,
                ocr_scans_count: scanCount,
                total_receipts_processed: totalReceiptsProcessed || 0,
                total_corrections_made: totalCorrectionsMade || 0,
                average_accuracy_rating: Math.round(averageAccuracy * 100) / 100,
                accuracy_rate: accuracyRate
            }
        });
    } catch (error) {
        console.error('Error fetching aggregated analytics:', error);
        return NextResponse.json(
            { error: 'Failed to fetch aggregated analytics', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
