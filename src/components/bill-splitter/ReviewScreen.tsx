
import React from 'react';
import { BillData, User, Group } from '@/types';
import { ExpenseCalculationService } from '@/services/expense-calculations';

interface ReviewScreenProps {
  billData: BillData;
  onUpdate: (updates: Partial<BillData>) => void;
  members: User[];
  groups: Group[];
  authUserId?: string;
}

export const ReviewScreen: React.FC<ReviewScreenProps> = ({ billData, onUpdate, members, groups, authUserId }) => {
  const selectedMembers = members.filter(u => billData.selectedMemberIds.includes(u.id));

  // Determine who can be a payer based on the context (Group or Individual split)
  const payerList = billData.groupId
    ? (groups.find(g => g.id === billData.groupId)?.members || [])
    : members.filter(u => billData.selectedMemberIds.includes(u.id) || u.id === authUserId);

  const splits: Record<string, number> = {};
  selectedMembers.forEach(m => (splits[m.id] = 0));

  billData.items.forEach(item => {
    if (item.splitType === 'quantity' && item.quantityAssignments) {
      {/* Added type assertion for Object.values on Record<string, number> */ }
      const totalUnits = (Object.values(item.quantityAssignments) as number[]).reduce((a, b) => a + b, 0);
      if (totalUnits > 0) {
        const unitPrice = item.price / totalUnits;
        {/* Added type assertion for Object.entries on Record<string, number> */ }
        (Object.entries(item.quantityAssignments) as [string, number][]).forEach(([mId, units]) => {
          if (splits[mId] !== undefined) splits[mId] += unitPrice * units;
        });
      } else {
        // Fallback if no units assigned but splitType is quantity
        const share = item.price / item.splitMemberIds.length;
        item.splitMemberIds.forEach(mId => {
          if (splits[mId] !== undefined) splits[mId] += share;
        });
      }
    } else {
      if (item.splitMemberIds.length > 0) {
        const share = item.price / item.splitMemberIds.length;
        item.splitMemberIds.forEach(mId => {
          if (splits[mId] !== undefined) splits[mId] += share;
        });
      }
    }
  });

  const subtotal = billData.items.reduce((s, i) => s + i.price, 0);
  const overhead = (billData.tax + billData.otherCharges - billData.discount);
  const totalBill = subtotal + overhead;

  if (subtotal > 0) {
    Object.keys(splits).forEach(mId => {
      const proportion = splits[mId] / subtotal;
      splits[mId] += overhead * proportion;
    });
  } else if (selectedMembers.length > 0) {
    Object.keys(splits).forEach(mId => {
      splits[mId] += overhead / selectedMembers.length;
    });
  }

  // Adjust for cent-level rounding so displayed amounts sum to the bill total exactly.
  const memberIds = selectedMembers.map(m => m.id);
  const adjustedSplits = ExpenseCalculationService.adjustSplitsForRounding(splits, memberIds, totalBill);

  const MULTIPLE_PAYERS_VALUE = '__multiple__';

  const isMultiplePayers = billData.payerId === MULTIPLE_PAYERS_VALUE;

  const whoPaidDropdownValue = (() => {
    if (isMultiplePayers) return MULTIPLE_PAYERS_VALUE;
    if (billData.payerShares && Object.keys(billData.payerShares).filter(k => (billData.payerShares![k] ?? 0) > 0).length > 1) return MULTIPLE_PAYERS_VALUE;
    return billData.payerId || '';
  })();

  const handleWhoPaidChange = (value: string) => {
    if (value === MULTIPLE_PAYERS_VALUE) {
      const currentSingle = billData.payerId && billData.payerId !== MULTIPLE_PAYERS_VALUE ? billData.payerId : null;
      onUpdate({
        payerId: MULTIPLE_PAYERS_VALUE,
        payerShares: currentSingle ? { [currentSingle]: totalBill } : {}
      });
    } else {
      onUpdate({ payerId: value, payerShares: undefined });
    }
  };

  const getPaidAmount = (memberId: string): number => {
    if (billData.payerShares && typeof billData.payerShares[memberId] === 'number') {
      return billData.payerShares[memberId];
    }
    if (billData.payerId && billData.payerId !== MULTIPLE_PAYERS_VALUE && billData.payerId === memberId) return totalBill;
    return 0;
  };

  const setPaidAmount = (memberId: string, value: number) => {
    const next = { ...(billData.payerShares || {}) };
    if (value === 0) delete next[memberId];
    else next[memberId] = Math.max(0, value);
    onUpdate({ payerShares: next, payerId: MULTIPLE_PAYERS_VALUE });
  };

  const totalPaid = payerList.reduce((sum, m) => sum + getPaidAmount(m.id), 0);
  const paidValid = Math.abs(totalPaid - totalBill) < 0.02;

  const generateSummary = () => {
    let summary = `Detailed Split for ${billData.storeName || 'Bill'}:\n\n`;

    if (billData.items.length > 0) {
      billData.items.forEach((item, idx) => {
        if (item.splitType === 'quantity' && item.quantityAssignments) {
          {/* Added type assertion for Object.values on Record<string, number> */ }
          const totalUnits = (Object.values(item.quantityAssignments) as number[]).reduce((a, b) => a + b, 0);
          const unitPrice = item.price / (totalUnits || 1);
          summary += `${idx + 1}. ${item.name} (Qty Split): $${item.price.toFixed(2)}\n`;
          {/* Added type assertion for Object.entries on Record<string, number> */ }
          (Object.entries(item.quantityAssignments) as [string, number][]).forEach(([mId, units]) => {
            const name = members.find(u => u.id === mId)?.name || 'Unknown';
            summary += `   - ${name}: ${units} unit(s) @ $${(unitPrice * units).toFixed(2)}\n`;
          });
        } else {
          const perPerson = item.price / (item.splitMemberIds.length || 1);
          const names = item.splitMemberIds.map(id => members.find(u => u.id === id)?.name).join(', ');
          summary += `${idx + 1}. ${item.name}: $${item.price.toFixed(2)} ($${perPerson.toFixed(2)} each for ${names})\n`;
        }
      });
    }

    summary += `\nSummary:`;
    summary += `\n- Subtotal: $${subtotal.toFixed(2)}`;
    if (billData.tax) summary += `\n- Tax: $${billData.tax.toFixed(2)}`;
    if (billData.otherCharges) summary += `\n- Fees: $${billData.otherCharges.toFixed(2)}`;
    if (billData.discount) summary += `\n- Discount: -$${billData.discount.toFixed(2)}`;

    summary += `\n\nFinal Settlement Totals:\n`;
    selectedMembers.forEach(m => {
      summary += `- ${m.name === 'Me' ? 'Your total' : m.name}: $${adjustedSplits[m.id].toFixed(2)}\n`;
    });

    onUpdate({ notes: summary });
  };

  return (
    <div className="space-y-8 animate-slide-up pb-24 w-full">
      <section className="bg-card text-card-foreground rounded-[2.5rem] p-8 shadow-xl shadow-primary/5 border border-border space-y-6 w-full">
        <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest border-b border-border pb-4">General Info</h3>

        <div className="space-y-6">
          <div className="group">
            <label className="block text-[10px] font-black text-primary uppercase mb-2 tracking-tighter">Business Name</label>
            <input
              type="text"
              value={billData.storeName}
              onChange={(e) => onUpdate({ storeName: e.target.value })}
              className="w-full text-2xl font-black text-foreground border-none focus:ring-0 placeholder:text-muted-foreground/30 bg-transparent focus:bg-transparent shadow-none !min-h-0 !p-0"
              placeholder="Starbucks Coffee..."
            />
          </div>

          <div className="pt-4 border-t border-border">
            <label className="block text-[10px] font-black text-muted-foreground uppercase mb-2">Billing Date</label>
            <div className="relative w-full">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-primary z-20">
                <i className="fas fa-calendar-alt"></i>
              </div>
              <input
                type="date"
                value={billData.date}
                onChange={(e) => onUpdate({ date: e.target.value })}
                className="w-full block text-sm font-bold text-foreground border-none bg-muted/50 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer transition-all hover:bg-muted appearance-none relative z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-inner-spin-button]:hidden [&::-webkit-clear-button]:hidden"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <label className="block text-[10px] font-black text-muted-foreground uppercase mb-2">Who paid?</label>
            <div className="relative w-full">
              <select
                value={whoPaidDropdownValue}
                onChange={(e) => handleWhoPaidChange(e.target.value)}
                className="w-full block text-sm font-bold text-foreground border-none bg-muted/50 rounded-2xl py-4 pl-4 pr-10 focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer transition-all hover:bg-muted"
              >
                <option value="">Select who paid</option>
                {payerList.map(m => (
                  <option key={m.id} value={m.id}>{m.name === 'Me' ? 'Paid by me' : m.name}</option>
                ))}
                <option value={MULTIPLE_PAYERS_VALUE}>Multiple people</option>
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground/50 z-10">
                <i className="fas fa-chevron-down text-[10px]"></i>
              </div>
            </div>

            {isMultiplePayers && (
              <>
                <p className="text-xs text-muted-foreground mt-3 mb-2">Enter the amount each person paid. Total paid should equal the bill total.</p>
                <div className="space-y-3">
                  {payerList.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-4 p-3 bg-muted/50 rounded-[2.5rem]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl overflow-hidden border border-border shrink-0">
                          <img src={m.avatar} className="w-full h-full object-cover" alt="" />
                        </div>
                        <span className="text-sm font-bold text-foreground truncate">{m.name === 'Me' ? 'Me' : m.name}</span>
                      </div>
                      <div className="flex items-center bg-muted/80 px-2 py-2 rounded-2xl border border-border group-hover:bg-muted transition-colors shrink-0">
                        <span className="text-muted-foreground text-xs font-bold mr-1">$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={getPaidAmount(m.id) || ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? 0 : parseFloat(e.target.value);
                            setPaidAmount(m.id, Number.isNaN(v) ? 0 : v);
                          }}
                          placeholder="0"
                          className="w-14 font-black text-foreground border-none focus:ring-0 text-right bg-transparent !min-h-0 !p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`mt-2 text-xs font-bold ${paidValid ? 'text-muted-foreground' : 'text-amber-600'}`}>
                  Total paid: ${totalPaid.toFixed(2)} {!paidValid && `(should be $${totalBill.toFixed(2)})`}
                </div>
              </>
            )}
          </div>

          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] font-black text-muted-foreground uppercase">Description</label>
              <button
                onClick={generateSummary}
                className="text-xs font-bold text-primary underline hover:text-primary/80 transition-colors"
              >
                Auto-Fill Details
              </button>
            </div>
            <textarea
              value={billData.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="w-full text-sm font-bold text-foreground/70 border-none bg-muted/50 rounded-2xl p-4 focus:outline-none focus:ring-0 min-h-[120px] resize-none"
              placeholder="Split details will appear here..."
            />
          </div>
        </div>
      </section>

      <section className="bg-card text-card-foreground rounded-[2.5rem] p-8 shadow-xl shadow-primary/5 border border-border space-y-6">
        <h3 className="text-[10px] font-black text-primary uppercase tracking-widest border-b border-border pb-4">Each payee’s share (owed)</h3>

        <div className="space-y-4">
          {selectedMembers.map(member => (
            <div key={member.id} className="flex items-center justify-between p-4 rounded-[2.5rem] border border-border bg-muted/30 hover:bg-accent hover:shadow-lg transition-all duration-300">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl overflow-hidden border border-border shadow-sm bg-primary/10">
                  <img src={member.avatar} className="w-full h-full object-cover" alt="" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-foreground">{member.name}</span>
                  <span className="text-[9px] font-bold text-emerald-500 uppercase">Owes this amount</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-black text-primary tracking-tight">${adjustedSplits[member.id].toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-8 flex flex-col items-center border-t border-border">
          <span className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.2em] mb-1">Total Bill Amount</span>
          <span className="text-4xl font-black text-foreground tracking-tighter">${(subtotal + overhead).toFixed(2)}</span>
        </div>
      </section>
    </div>
  );
};
