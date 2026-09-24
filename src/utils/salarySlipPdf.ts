import { jsPDF } from 'jspdf';
import { monthLabel } from './month';

export interface SalarySlipData {
  name: string;
  code: number;
  entitySlug: string;
  designation: string | null;
  department: string | null;
  dateOfJoining: string | null;
  location: string | null;
  bankName: string | null;
  bankAccount: string | null;
  ifsc: string | null;
  uan: string | null;
  currency: string | null;
  salary: number | null;
  netPayable: number | null;
  deductionRows: [string, number][];
  additionRows: [string, number][];
  totalDeductions: number;
  totalAdditions: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmount(n: number | null | undefined, currency: string | null): string {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

// One-page payslip, built with plain jsPDF text/rect primitives rather than a table plugin — the
// layout is simple enough (two label/value columns, two aligned earnings/deductions lists) that a
// hand-laid-out page needs no extra dependency beyond jsPDF itself.
export function downloadSalarySlip(slip: SalarySlipData, selectedMonth: string): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 48;
  let y = 56;

  doc.setFillColor(92, 96, 239); // var(--purple)
  doc.rect(0, 0, pageWidth, 64, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('KOENIG SOLUTIONS', marginX, 32);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Salary Slip — ${monthLabel(selectedMonth)}`, marginX, 50);

  y = 96;
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(slip.name, marginX, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Employee Code ${slip.code} · ${slip.entitySlug}`, marginX, y);

  y += 26;
  const col2X = pageWidth / 2 + 10;
  const detailRows: [string, string][] = [
    ['Designation', slip.designation || '—'],
    ['Department', slip.department || '—'],
    ['Date of Joining', fmtDate(slip.dateOfJoining)],
    ['Base Location', slip.location || '—'],
    ['Bank Name', slip.bankName || '—'],
    ['Bank Account No.', slip.bankAccount || '—'],
    ['IFSC Code', slip.ifsc || '—'],
    ['UAN', slip.uan || '—'],
  ];
  const rowHeight = 34;
  detailRows.forEach(([label, value], i) => {
    const rowY = y + Math.floor(i / 2) * rowHeight;
    const x = i % 2 === 0 ? marginX : col2X;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(130, 130, 130);
    doc.text(label.toUpperCase(), x, rowY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 30, 30);
    doc.text(value, x, rowY + 15);
  });
  y += Math.ceil(detailRows.length / 2) * rowHeight + 20;

  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 26;

  const tableTop = y;
  const colWidth = (pageWidth - marginX * 2 - 20) / 2;
  const earningsX = marginX;
  const deductionsX = marginX + colWidth + 20;

  function drawColumn(x: number, title: string, dotColor: [number, number, number], rows: [string, number][], total: number, totalLabel: string) {
    let cy = tableTop;
    doc.setFillColor(...dotColor);
    doc.circle(x + 4, cy - 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(title, x + 14, cy);
    cy += 18;
    doc.setDrawColor(230, 230, 230);
    doc.line(x, cy - 12, x + colWidth, cy - 12);
    rows.forEach(([label, value]) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(80, 80, 80);
      doc.text(label, x, cy);
      doc.setTextColor(30, 30, 30);
      doc.text(fmtAmount(value, slip.currency), x + colWidth, cy, { align: 'right' });
      cy += 17;
    });
    doc.setDrawColor(210, 210, 210);
    doc.line(x, cy - 4, x + colWidth, cy - 4);
    cy += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(totalLabel, x, cy);
    doc.text(fmtAmount(total, slip.currency), x + colWidth, cy, { align: 'right' });
    return cy;
  }

  const earningsRows: [string, number][] = [['Salary', slip.salary ?? 0], ...slip.additionRows];
  const earningsTotal = (slip.salary ?? 0) + slip.totalAdditions;
  const bottomEarnings = drawColumn(earningsX, 'Earnings', [12, 163, 12], earningsRows, earningsTotal, 'Total Earnings');
  const bottomDeductions = drawColumn(deductionsX, 'Deductions', [224, 82, 82], slip.deductionRows, slip.totalDeductions, 'Total Deductions');

  y = Math.max(bottomEarnings, bottomDeductions) + 30;
  doc.setFillColor(92, 96, 239);
  doc.roundedRect(marginX, y, pageWidth - marginX * 2, 44, 6, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('NET PAYABLE', marginX + 16, y + 27);
  doc.setFontSize(16);
  doc.text(fmtAmount(slip.netPayable, slip.currency), pageWidth - marginX - 16, y + 29, { align: 'right' });

  y += 70;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text('This is a system-generated salary slip and does not require a signature. For queries, contact HR.', marginX, y);

  const fileMonth = monthLabel(selectedMonth).replace(/\s+/g, '_');
  doc.save(`Salary_Slip_${slip.code}_${fileMonth}.pdf`);
}
