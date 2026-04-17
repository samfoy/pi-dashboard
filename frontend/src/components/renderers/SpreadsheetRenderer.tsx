import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'

interface SpreadsheetRendererProps {
  filePath: string
}

const BTN = 'px-2 py-1 rounded-md text-[12px] font-medium border border-border text-muted hover:text-text cursor-pointer disabled:opacity-40'
const ACTIVE_TAB = 'px-2 py-1 rounded-md text-[12px] font-medium border border-accent text-accent bg-accent-subtle cursor-pointer'

export default function SpreadsheetRenderer({ filePath }: SpreadsheetRendererProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [activeSheet, setActiveSheet] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const url = `/api/local-file?path=${encodeURIComponent(filePath)}`
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(arrayBuffer => {
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' })
        if (!cancelled) {
          setWorkbook(wb)
          setActiveSheet(wb.SheetNames[0] || '')
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load spreadsheet')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [filePath])

  const data: string[][] = useMemo(() => {
    if (!workbook || !activeSheet) return []
    const sheet = workbook.Sheets[activeSheet]
    if (!sheet) return []
    return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })
  }, [workbook, activeSheet])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted text-sm">Loading spreadsheet...</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-danger text-sm">{error}</div>
  }

  return (
    <div className="flex flex-col w-full h-full">
      {/* Sheet tabs (only if multiple sheets) */}
      {workbook && workbook.SheetNames.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-chrome text-[12px] shrink-0 overflow-x-auto">
          {workbook.SheetNames.map(name => (
            <button
              key={name}
              className={name === activeSheet ? ACTIVE_TAB : BTN}
              onClick={() => setActiveSheet(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          {data.length > 0 && (
            <thead className="sticky top-0 z-10">
              <tr>
                {data[0].map((cell, i) => (
                  <th key={i} className="text-left text-muted text-[13px] font-medium px-3 py-2 border-b border-border bg-chrome whitespace-nowrap">
                    {String(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {data.slice(1).map((row, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-bg-elevated/50' : ''}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 border-b border-border text-sm whitespace-nowrap">
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
