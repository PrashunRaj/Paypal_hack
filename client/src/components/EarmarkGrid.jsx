import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { money } from '../lib/api';
import { useDarkMode } from '../lib/config';
import Badge from './Badge';

export default function EarmarkGrid({ earmarks, selectedId, onSelect }) {
  const dark = useDarkMode();
  const columnDefs = useMemo(() => {
    const cur = (p) => money(p.value, p.data?.currency);
    return [
      { field: 'title', headerName: 'Earmark', flex: 1.4, minWidth: 150 },
      { field: 'recipientName', headerName: 'For', flex: 1, minWidth: 100 },
      { field: 'amount', headerName: 'Held', valueFormatter: cur, type: 'rightAligned', minWidth: 110 },
      { field: 'spent', headerName: 'Released', valueFormatter: cur, type: 'rightAligned', minWidth: 110 },
      { field: 'remaining', headerName: 'Left', valueFormatter: cur, type: 'rightAligned', minWidth: 110 },
      { field: 'receiptCount', headerName: 'Bills', width: 90, type: 'rightAligned' },
      {
        field: 'pendingReviews', headerName: 'Review', width: 120,
        cellRenderer: (p) => (p.value ? <Badge tone="warn">{p.value} waiting</Badge> : null),
      },
      {
        field: 'highRiskBills', headerName: 'Risk', width: 120,
        cellRenderer: (p) => (p.value ? <Badge tone="bad">{p.value} high risk</Badge> : null),
      },
      { field: 'status', headerName: 'Status', minWidth: 140, cellRenderer: (p) => <Badge status={p.value} /> },
    ];
  }, []);

  return (
    <div className={dark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'}>
      <AgGridReact
        rowData={earmarks}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, filter: true, flex: 1, minWidth: 100 }}
        domLayout="autoHeight"
        getRowId={(p) => p.data.id}
        rowClassRules={{ 'ag-row-selected': (p) => p.data.id === selectedId }}
        overlayNoRowsTemplate="No earmarks yet. Create one on the right."
        onRowClicked={(e) => onSelect(e.data.id)}
      />
    </div>
  );
}
