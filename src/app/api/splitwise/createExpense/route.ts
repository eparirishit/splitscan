import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SPLITWISE_CONFIG, APP_CONFIG } from '@/lib/config';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(APP_CONFIG.AUTH_COOKIE_NAME)?.value;

  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const expenseData = await request.json();

  // Core fields validation
  if (!expenseData || !expenseData.cost || !expenseData.description) {
    return NextResponse.json(
      { error: 'Invalid expense data payload: missing cost or description' },
      { status: 400 }
    );
  }

  // Allow group_id to be 0 for friend expenses
  if (expenseData.group_id !== undefined && expenseData.group_id < 0) {
    return NextResponse.json(
      { error: 'Invalid group_id: must be 0 or greater' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${SPLITWISE_CONFIG.API_BASE_URL}/create_expense`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(expenseData),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || 'Failed to create expense' },
        { status: response.status }
      );
    }

    // Splitwise returns HTTP 200 even on validation failures, with errors in the body.
    // An expense that was not created will have no id, so we must check for this.
    if (result.errors && Object.keys(result.errors).length > 0) {
      const errorMessage = Object.values(result.errors as Record<string, string[]>)
        .flat()
        .join(', ');
      return NextResponse.json(
        { error: errorMessage || 'Splitwise rejected the expense' },
        { status: 422 }
      );
    }

    const expenseId = result?.expenses?.[0]?.id;
    if (!expenseId) {
      return NextResponse.json(
        { error: 'Splitwise did not return a valid expense ID' },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error creating expense:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
