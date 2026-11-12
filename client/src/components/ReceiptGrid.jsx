import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { money } from '../lib/api';
import { useDarkMode } from '../lib/config';
import Badge from './Badge';
import RiskBadge from './RiskBadge';

export default function ReceiptGrid({ receipts, currency, selectedId, onSelect }) {
  const dark = useDarkMode();
  const columnDefs = useMemo(() => [
    { field: 'uploadedAt', headerName: 'Uploaded', minWidth: 170, valueFormatter: (p) => new Date(p.value).toLocaleString() },
    { headerName: 'Merchant', flex: 1, minWidth: 130, valueGetter: (p) => p.data.extraction?.merchant || '—' },
    {
      headerName: 'Bill', type: 'rightAligned', minWidth: 100,
      valueGetter: (p) => p.data.extraction?.total ?? null,
      valueFormatter: (p) => (p.value == null ? '—' : money(p.value, currency)),
    },
    { field: 'paidAmount', headerName: 'Released', type: 'rightAligned', minWidth: 110, valueFormatter: (p) => money(p.value, currency) },
    {
      field: 'riskScore', headerName: 'Risk', minWidth: 140,
      cellRenderer: (p) => <RiskBadge score={p.value} level={p.data.riskLevel} />,
    },
    { field: 'status', headerName: 'Status', minWidth: 160, cellRenderer: (p) => <Badge status={p.value} /> },
  ], [currency]);

  return (
    <div className={dark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'}>
      <AgGridReact
        rowData={receipts}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, flex: 1, minWidth: 90 }}
        domLayout="autoHeight"
        getRowId={(p) => p.data.id}
        rowClassRules={{ 'ag-row-selected': (p) => p.data.id === selectedId }}
        overlayNoRowsTemplate="No bills uploaded yet."
        onRowClicked={(e) => onSelect(e.data.id)}
      />
    </div>
  );
}
