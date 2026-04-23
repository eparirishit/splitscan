import type { CreateExpense, SplitwiseGroup, SplitwiseUser, SplitwiseFriend } from '@/types';
import { AI_CONFIG } from '@/lib/config';

export class SplitwiseService {
  private static async makeApiRequest(endpoint: string, options: RequestInit = {}) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET', // Default method
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error for ${endpoint}:`, response.status, errorText);
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Network error: ${error}`);
    }
  }

  // Fetch all groups
  static async getGroups(): Promise<SplitwiseGroup[]> {
    try {
      const data = await this.makeApiRequest('/api/splitwise/getGroups');
      return data.groups || [];
    } catch (error) {
      throw new Error(`Failed to fetch groups: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fetch recent groups
  static async getRecentGroups(): Promise<SplitwiseGroup[]> {
    try {
      const data = await this.makeApiRequest('/api/splitwise/getRecentGroups');
      return data.groups || [];
    } catch (error) {
      throw new Error(`Failed to fetch recent groups: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fetch a specific group
  static async getGroup(groupId: number): Promise<SplitwiseGroup> {
    try {
      const data = await this.makeApiRequest(`/api/splitwise/getGroup/${groupId}`);
      return data.group;
    } catch (error) {
      throw new Error(`Failed to fetch group: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fetch members of a specific group
  static async getGroupMembers(groupId: string): Promise<SplitwiseUser[]> {
    try {
      const data = await this.makeApiRequest(`/api/splitwise/getGroup/${groupId}`);
      return data.group?.members || [];
    } catch (error) {
      throw new Error(`Failed to fetch group members: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Create an expense
  static async createExpense(expense: CreateExpense): Promise<any> {
    try {
      return await this.makeApiRequest('/api/splitwise/createExpense', {
        method: 'POST',
        body: JSON.stringify(expense),
      });
    } catch (error) {
      throw new Error(`Failed to create expense: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get current user info
  static async getCurrentUser(): Promise<SplitwiseUser> {
    try {
      const data = await this.makeApiRequest('/api/splitwise/getCurrentUser');
      return data.user;
    } catch (error) {
      throw new Error(`Failed to fetch current user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Fetch all friends
  static async getFriends(): Promise<SplitwiseFriend[]> {
    try {
      const data = await this.makeApiRequest('/api/splitwise/getFriends');
      return data.friends || [];
    } catch (error) {
      throw new Error(`Failed to fetch friends: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Add a new friend
  static async addFriend(email: string, firstName?: string, lastName?: string): Promise<SplitwiseFriend> {
    try {
      const requestBody: Record<string, string> = { user_email: email };
      if (firstName) requestBody.first_name = firstName;
      if (lastName) requestBody.last_name = lastName;

      const data = await this.makeApiRequest('/api/splitwise/addFriend', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      return data.friend;
    } catch (error) {
      throw new Error(`Failed to add friend: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Validate expense data before sending to API
  static validateExpenseData(expense: CreateExpense): { isValid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};

    if (!expense.cost) {
      errors.cost = 'Cost is required';
    } else if (isNaN(parseFloat(expense.cost))) {
      errors.cost = 'Cost must be a valid number';
    } else if (parseFloat(expense.cost) <= 0) {
      errors.cost = 'Cost must be greater than 0';
    }

    if (!expense.description?.trim()) {
      errors.description = 'Description is required';
    }

    if (expense.group_id !== undefined && expense.group_id !== null) {
      if (isNaN(Number(expense.group_id))) {
        errors.group_id = 'Group ID must be a valid number';
      } else if (expense.group_id < 0) {
        errors.group_id = 'Group ID must be 0 or greater';
      }
    }

    // Check for user data using dynamic keys
    const userKeys = Object.keys(expense).filter(key => key.startsWith('users__') && key.endsWith('__user_id'));
    if (userKeys.length === 0) {
      errors.users = 'At least one user must be specified';
    } else {
      // Validate each user's data
      let totalPaid = 0;
      let totalOwed = 0;

      for (const userKey of userKeys) {
        const userIndex = userKey.match(/users__(\d+)__user_id/)?.[1];
        if (!userIndex) continue;

        const userId = expense[`users__${userIndex}__user_id` as keyof CreateExpense];
        const paidShare = expense[`users__${userIndex}__paid_share` as keyof CreateExpense];
        const owedShare = expense[`users__${userIndex}__owed_share` as keyof CreateExpense];

        if (!userId || !paidShare || !owedShare) {
          errors.users = 'User data is invalid';
          break;
        }

        // Check if user ID is valid
        if (isNaN(Number(userId))) {
          errors.users = 'User data is invalid';
          break;
        }

        totalPaid += parseFloat(paidShare as string);
        totalOwed += parseFloat(owedShare as string);
      }

      // Check if total paid share equals total owed share
      if (Math.abs(totalPaid - totalOwed) > AI_CONFIG.ROUNDING_TOLERANCE) {
        errors.shares = 'Total paid share must equal total owed share';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  // Format expense data for API submission
  static formatExpensePayload(expenseData: {
    cost: number;
    description: string;
    group_id: number;
    split_equally: boolean;
    /** Expense date as YYYY-MM-DD. Sent to Splitwise verbatim so the expense is recorded on the correct day. */
    date?: string;
    users: Array<{ id: number; first_name: string; last_name: string }>;
    customAmounts?: Record<string, number>;
    /** Amount each user paid (userId -> amount). Sum should equal cost. If set, used for paid_share; else first user pays full. */
    paidShares?: Record<string, number>;
  }): CreateExpense {
    const payload: CreateExpense = {
      cost: expenseData.cost.toFixed(2),
      description: expenseData.description,
      group_id: expenseData.group_id,
      split_equally: expenseData.split_equally,
      ...(expenseData.date && { date: expenseData.date }),
    };

    // Normalise paidShares keys to strings so lookups always work regardless of
    // whether the caller supplied numeric or string user IDs.
    const rawPaidShares = expenseData.paidShares;
    const paidShares: Record<string, number> | undefined = rawPaidShares
      ? Object.fromEntries(Object.entries(rawPaidShares).map(([k, v]) => [String(k), v]))
      : undefined;

    if (expenseData.split_equally) {
      // Equal split: divide evenly, give the penny remainder to the last user.
      const rawShare = expenseData.cost / expenseData.users.length;
      let owedSoFar = 0;

      expenseData.users.forEach((user, index) => {
        payload[`users__${index}__user_id`] = user.id;
        const paid = paidShares ? (paidShares[String(user.id)] ?? 0) : (index === 0 ? expenseData.cost : 0);
        payload[`users__${index}__paid_share`] = paid.toFixed(2);

        const isLast = index === expenseData.users.length - 1;
        const owedShare = isLast
          ? Math.round((expenseData.cost - owedSoFar) * 100) / 100
          : Math.round(rawShare * 100) / 100;
        owedSoFar += owedShare;
        payload[`users__${index}__owed_share`] = owedShare.toFixed(2);
      });
    } else {
      // Custom split: owed from customAmounts, paid from paidShares or first user pays full.
      // Round all but the last user; assign the remainder to the last user so the
      // sum of owed shares always equals the total cost exactly.
      const customAmounts = expenseData.customAmounts || {};
      let owedSoFar = 0;

      expenseData.users.forEach((user, index) => {
        payload[`users__${index}__user_id`] = user.id;
        const paid = paidShares ? (paidShares[String(user.id)] ?? 0) : (index === 0 ? expenseData.cost : 0);
        payload[`users__${index}__paid_share`] = paid.toFixed(2);

        const isLast = index === expenseData.users.length - 1;
        const owedShare = isLast
          ? Math.round((expenseData.cost - owedSoFar) * 100) / 100
          : Math.round((customAmounts[String(user.id)] || 0) * 100) / 100;
        owedSoFar += owedShare;
        payload[`users__${index}__owed_share`] = owedShare.toFixed(2);
      });
    }

    // Safety net: if the total paid_share still doesn't equal the cost (e.g. a
    // payer ID in paidShares didn't match any user after normalisation), find the
    // intended payer and top up their paid_share by the unpaid remainder only —
    // never overwrite a partial share that was already correctly assigned.
    const totalPaid = expenseData.users.reduce((sum, _, index) => {
      return sum + parseFloat((payload[`users__${index}__paid_share`] as string) || '0');
    }, 0);

    const unpaidRemainder = Math.round((expenseData.cost - totalPaid) * 100) / 100;

    if (expenseData.users.length > 0 && Math.abs(unpaidRemainder) > 0.01) {
      // Find the intended payer by matching paidShares keys against the users list.
      // Prefer a payer whose share was NOT already assigned (paid_share == 0).
      const payerIndex = paidShares
        ? expenseData.users.findIndex(u => {
            const key = String(u.id);
            return (key in paidShares) &&
                   parseFloat((payload[`users__${expenseData.users.indexOf(u)}__paid_share`] as string) || '0') === 0;
          })
        : -1;
      // Fall back to any user that appears in paidShares, then to index 0.
      const fallbackIndex = paidShares
        ? expenseData.users.findIndex(u => String(u.id) in paidShares)
        : -1;
      const targetIndex = payerIndex !== -1 ? payerIndex : fallbackIndex !== -1 ? fallbackIndex : 0;

      const existing = parseFloat((payload[`users__${targetIndex}__paid_share`] as string) || '0');
      const corrected = Math.round((existing + unpaidRemainder) * 100) / 100;

      console.warn(
        `[formatExpensePayload] Paid share total (${totalPaid}) ≠ cost (${expenseData.cost}). ` +
        `Adding remainder ${unpaidRemainder} to user at index ${targetIndex} (id: ${expenseData.users[targetIndex]?.id}).`
      );
      payload[`users__${targetIndex}__paid_share`] = corrected.toFixed(2);
    }

    return payload as CreateExpense;
  }
}